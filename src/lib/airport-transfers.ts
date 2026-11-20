import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DriverError, integer, text } from "@/lib/driver/errors";
import { evaluateDriverApplication } from "@/lib/driver/eligibility";
import { AIRPORT_SERVICES, RIDE_SERVICES, airportConflict, airportWindow } from "@/lib/ride-service";
import { nairobiDayRange, nairobiEventAt } from "@/lib/nairobi-time";
import { normalizePhone } from "@/lib/session";
import { getEligibleDriverIds } from "@/lib/driver/availability";

const QUOTE_MS = 20 * 60_000;
const airportView = {
  id: true, airport: true, direction: true, address: true, pickupAt: true, passengers: true,
  flight: true, luggage: true, status: true, quoteKes: true, quoteExpiresAt: true,
} as const;
const bookedStatuses = ["awaiting_payment", "confirmed", "boarded"];
const stale = () => new DriverError(409, "TRANSFER_CHANGED", "This transfer changed. Refresh and try again.");

async function lockDriver(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Driver" WHERE "id" = ${id} FOR UPDATE`;
  const driver = await tx.driver.findUniqueOrThrow({
    where: { id },
    include: { application: { include: { documents: { where: { state: { not: "replaced" } } } } } },
  });
  if (!evaluateDriverApplication(driver.application, driver.status).eligible) {
    throw new DriverError(403, "DRIVER_NOT_ELIGIBLE", "Driver approval is required for airport transfers.");
  }
  return driver;
}

async function ensureSlot(tx: Prisma.TransactionClient, id: string, service: string, transfer: { id: string; pickupAt: Date }) {
  const { start, end } = airportWindow(transfer.pickupAt);
  const trips = await tx.trip.findMany({
    where: {
      driverId: id, departureAt: { lt: end }, status: { in: ["scheduled", "locked", "departed"] },
      ...(service === "airport" ? { OR: [
        { status: "departed" },
        { bookings: { some: { status: { in: bookedStatuses } } } },
        { reservedBookings: { some: { status: { in: bookedStatuses } } } },
      ] } : {}),
    },
    select: { status: true, departureAt: true, route: { select: { durationMinutes: true } } },
  });
  if (trips.some(trip => trip.status === "departed" ||
      trip.departureAt.getTime() + trip.route.durationMinutes * 60_000 > start.getTime()) ||
      await airportConflict(tx, id, start, end, transfer.id)) {
    throw new DriverError(409, "DRIVER_BUSY", "Another trip overlaps this pickup window.");
  }
}

export async function driverAirportTransfers(driverId: string) {
  const driver = await db.driver.findUniqueOrThrow({
    where: { id: driverId },
    include: { application: { include: { documents: { where: { state: { not: "replaced" } } } } } },
  });
  const eligible = evaluateDriverApplication(driver.application, driver.status).eligible;
  const now = new Date();
  const assigned = eligible ? await db.airportTransfer.findMany({
    where: { driverId, OR: [
      { status: "quoted", quoteExpiresAt: { gt: now } },
      { status: { in: ["confirmed", "in_progress"] } },
    ] },
    select: { ...airportView, contactPhone: true },
    take: 30, orderBy: { pickupAt: "asc" },
  }) : [];
  const requests = eligible && AIRPORT_SERVICES.includes(driver.rideService) ? await db.airportTransfer.findMany({
    where: {
      pickupAt: { gt: now }, passengers: { lte: driver.capacity },
      OR: [{ status: "requested" }, { status: "quoted", quoteExpiresAt: { lte: now } }],
    },
    select: airportView,
    take: 30, orderBy: { pickupAt: "asc" },
  }) : [];
  return {
    eligible, rideService: driver.rideService,
    assigned: assigned.map(({ contactPhone, ...transfer }) => ({
      ...transfer, contactPhone: transfer.status === "quoted" ? null : contactPhone,
    })),
    requests: requests.map(request => ({
      ...request, status: "requested", quoteKes: null, quoteExpiresAt: null,
    })),
  };
}

export async function setDriverRideService(driverId: string, value: unknown) {
  const service = RIDE_SERVICES.find(option => option === value);
  if (!service) throw new DriverError(400, "INVALID_SERVICE", "Choose SGR, Airport, or Both.");
  await db.$transaction(async tx => {
    await lockDriver(tx, driverId);
    await tx.driver.update({ where: { id: driverId }, data: { rideService: service } });
  });
  return driverAirportTransfers(driverId);
}

export async function createAirportTransfer(passengerId: string, body: Record<string, unknown>) {
  const owner = await db.passenger.findUnique({ where: { id: passengerId }, select: { phone: true } });
  if (!owner || owner.phone.startsWith("guest-")) {
    throw new DriverError(401, "SIGN_IN_REQUIRED", "Sign in to request an airport transfer.");
  }
  const airport = body.airport;
  const direction = body.direction;
  if ((airport !== "mba" && airport !== "uka") || (direction !== "from" && direction !== "to")) {
    throw new DriverError(400, "INVALID_JOURNEY", "Choose an airport and a transfer direction.");
  }
  const address = text(body.address, "Hotel or address", 3, 160);
  const rawPhone = text(body.contactPhone, "Contact number", 8, 30);
  const cleanPhone = rawPhone.replace(/[ ()-]/g, "");
  const contactPhone = /^\+[1-9]\d{7,14}$/.test(cleanPhone) ? cleanPhone : normalizePhone(cleanPhone);
  if (!contactPhone) throw new DriverError(400, "INVALID_PHONE", "Enter a Kenyan or international contact number.");
  const requestKey = text(body.requestKey, "Request reference", 16, 64);
  const passengers = integer(body.passengers, "Passengers", 1, 99);
  const optionalText = (value: unknown, label: string, max: number) => value ? text(value, label, 1, max) : null;
  const flight = optionalText(body.flight, "Flight number", 20);
  const luggage = optionalText(body.luggage, "Luggage", 100);
  let pickupAt: Date;
  try {
    pickupAt = nairobiEventAt(nairobiDayRange(String(body.date)).start, 0, String(body.time));
  } catch {
    throw new DriverError(400, "INVALID_PICKUP", "Enter a valid pickup date and time in Kenya time.");
  }
  const eligibleIds = await getEligibleDriverIds("airport");
  const matchingDriver = eligibleIds.length > 0 && await db.driver.findFirst({
    where: { id: { in: eligibleIds }, capacity: { gte: passengers } },
    select: { id: true },
  });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Passenger" WHERE "id" = ${passengerId} FOR UPDATE`;
    const existing = await tx.airportTransfer.findUnique({
      where: { passengerId_requestKey: { passengerId, requestKey } }, select: airportView,
    });
    if (existing) return existing;
    if (!eligibleIds.length) {
      throw new DriverError(409, "AIRPORT_SUPPLY_UNAVAILABLE", "Airport requests open when an approved driver enables airport rides.");
    }
    if (!matchingDriver) throw new DriverError(409, "AIRPORT_CAPACITY_UNAVAILABLE", "An airport cab cannot yet accommodate this group size.");
    const now = new Date();
    if (pickupAt <= now) throw new DriverError(400, "INVALID_PICKUP", "Choose a pickup date and time in the future.");
    const pending = await tx.airportTransfer.count({ where: {
      passengerId, pickupAt: { gt: now }, status: { in: ["requested", "quoted", "confirmed"] },
    } });
    if (pending >= 5) throw new DriverError(429, "TRANSFER_LIMIT", "Resolve an existing transfer before sending another request.");
    return tx.airportTransfer.create({
      data: { passengerId, requestKey, airport, direction, address, contactPhone, pickupAt, passengers, flight, luggage },
      select: airportView,
    });
  });
}

export async function passengerAirportTransfers(passengerId: string) {
  const requests = await db.airportTransfer.findMany({
    where: { passengerId },
    select: { ...airportView, driver: { select: { name: true, phone: true, plate: true } } },
    orderBy: { pickupAt: "desc" }, take: 30,
  });
  return requests.map(({ driver, ...request }) => ({
    ...request, driver: ["confirmed", "in_progress"].includes(request.status) ? driver : null,
  }));
}

export async function quoteAirportTransfer(driverId: string, id: string, amount: unknown) {
  const quoteKes = integer(amount, "Fare in KSh", 1, 1_000_000);
  await db.$transaction(async tx => {
    const driver = await lockDriver(tx, driverId);
    if (!AIRPORT_SERVICES.includes(driver.rideService)) throw new DriverError(403, "AIRPORT_DISABLED", "Enable airport rides first.");
    const now = new Date();
    const ride = await tx.airportTransfer.findFirst({
      where: { id, pickupAt: { gt: now }, passengers: { lte: driver.capacity }, OR: [
        { status: "requested" }, { status: "quoted", quoteExpiresAt: { lte: now } },
      ] },
      select: { id: true, pickupAt: true },
    });
    if (!ride) throw stale();
    await ensureSlot(tx, driverId, driver.rideService, ride);
    const result = await tx.airportTransfer.updateMany({
      where: { id, OR: [{ status: "requested" }, { status: "quoted", quoteExpiresAt: { lte: now } }] },
      data: {
        driverId, status: "quoted", quoteKes,
        quoteExpiresAt: new Date(Math.min(Date.now() + QUOTE_MS, ride.pickupAt.getTime())),
      },
    });
    if (!result.count) throw stale();
  });
  return driverAirportTransfers(driverId);
}

export async function updatePassengerAirportTransfer(passengerId: string, id: string, body: Record<string, unknown>) {
  if (body.action === "cancel") {
    const result = await db.airportTransfer.updateMany({
      where: { id, passengerId, status: { in: ["requested", "quoted", "confirmed"] } },
      data: { status: "cancelled" },
    });
    if (!result.count) throw stale();
  } else if (body.action === "confirm") {
    await db.$transaction(async tx => {
      const transfer = await tx.airportTransfer.findFirst({
        where: { id, passengerId, status: "quoted" },
        select: { id: true, driverId: true, pickupAt: true, passengers: true, quoteExpiresAt: true },
      });
      if (!transfer?.driverId || !transfer.quoteExpiresAt ||
          transfer.quoteExpiresAt.toISOString() !== body.quoteExpiresAt) throw stale();
      const driver = await lockDriver(tx, transfer.driverId);
      if (!AIRPORT_SERVICES.includes(driver.rideService) || driver.capacity < transfer.passengers) throw stale();
      await ensureSlot(tx, driver.id, driver.rideService, transfer);
      const now = new Date();
      if (transfer.quoteExpiresAt <= now || transfer.pickupAt <= now) throw stale();
      const result = await tx.airportTransfer.updateMany({
        where: {
          id, passengerId, status: "quoted", driverId: driver.id, quoteExpiresAt: transfer.quoteExpiresAt,
        },
        data: { status: "confirmed" },
      });
      if (!result.count) throw stale();
    });
  } else throw new DriverError(400, "INVALID_ACTION", "Choose confirm or cancel.");
  return airportPassengerOverview(passengerId);
}

export async function airportPassengerOverview(passengerId: string) {
  const [requests, eligibleDrivers] = await Promise.all([
    passengerAirportTransfers(passengerId), getEligibleDriverIds("airport"),
  ]);
  return { requests, hasAirportDrivers: eligibleDrivers.length > 0 };
}

export async function updateDriverAirportTransfer(driverId: string, id: string, action: unknown) {
  await db.$transaction(async tx => {
    await lockDriver(tx, driverId);
    const now = new Date();
    const ride = await tx.airportTransfer.findFirst({ where: { id, driverId }, select: { status: true, pickupAt: true } });
    if (!ride) throw stale();
    let status: string;
    if (action === "start" && ride.status === "confirmed" && now >= airportWindow(ride.pickupAt).start) {
      status = "in_progress";
    } else if (action === "complete" && ride.status === "in_progress") {
      status = "completed";
    } else if (action === "cancel" && ["quoted", "confirmed"].includes(ride.status)) {
      status = ride.status === "quoted" ? "requested" : "cancelled";
    } else throw new DriverError(409, "INVALID_ACTION", "This action is unavailable for the current transfer.");
    const result = await tx.airportTransfer.updateMany({
      where: { id, driverId, status: ride.status },
      data: status === "requested" ? { status, driverId: null, quoteKes: null, quoteExpiresAt: null } : { status },
    });
    if (!result.count) throw stale();
  });
  return driverAirportTransfers(driverId);
}
