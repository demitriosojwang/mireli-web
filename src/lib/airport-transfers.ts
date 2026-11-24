import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DriverError, integer, text } from "@/lib/driver/errors";
import { evaluateDriverApplication } from "@/lib/driver/eligibility";
import { AIRPORT_SERVICES, RIDE_SERVICES, airportConflict, airportWindow } from "@/lib/ride-service";
import { nairobiDayRange, nairobiEventAt } from "@/lib/nairobi-time";
import { normalizePhone } from "@/lib/session";
import { getAirportByCode } from "@/lib/airport-catalogue";
import { isTransferPin, nearAirport, type TransferPin } from "@/lib/airport-transfer-pins";
import { getEligibleDriverIds } from "@/lib/driver/availability";

const airportView = {
  id: true, airport: true, direction: true, address: true, pickupAt: true, passengers: true,
  flight: true, luggage: true, status: true,
} as const;
const navigationView = {
  addressLat: true, addressLng: true, airportLat: true, airportLng: true,
  pickupNote: true, arrivedAt: true,
} as const;
const trackingView = { driverLat: true, driverLng: true, driverSeenAt: true, etaSeconds: true } as const;
const clearedTracking = { driverLat: null, driverLng: null, driverSeenAt: null, etaSeconds: null };
const POSITION_INTERVAL_MS = 3_000;
const POSITION_FRESHNESS_MS = 90_000;

function optionalPin(value: unknown): TransferPin | null {
  if (value == null) return null;
  if (isTransferPin(value)) return value;
  throw new DriverError(400, "INVALID_PIN", "Choose a valid pin on the Kenya coast.");
}

type TransferNavigationRecord = {
  airport: string; direction: string; address: string;
  addressLat: number | null; addressLng: number | null;
  airportLat: number | null; airportLng: number | null;
  pickupNote: string | null; arrivedAt: Date | null;
};

function navigationFor(ride: TransferNavigationRecord) {
  const airport = getAirportByCode(ride.airport.toUpperCase());
  const airportPin = {
    name: airport?.name ?? "Airport",
    lat: ride.airportLat ?? airport?.lat ?? null,
    lng: ride.airportLng ?? airport?.lng ?? null,
  };
  const addressPin = { name: ride.address, lat: ride.addressLat, lng: ride.addressLng };
  return {
    pickup: ride.direction === "from" ? airportPin : addressPin,
    dropoff: ride.direction === "from" ? addressPin : airportPin,
    pickupNote: ride.pickupNote,
    arrivedAt: ride.arrivedAt,
  };
}

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
    where: { driverId, status: { in: ["confirmed", "in_progress"] } },
    select: { ...airportView, ...navigationView, contactPhone: true },
    take: 30, orderBy: { pickupAt: "asc" },
  }) : [];
  const requests = eligible && AIRPORT_SERVICES.includes(driver.rideService) ? await db.airportTransfer.findMany({
    where: {
      pickupAt: { gt: now }, passengers: { lte: driver.capacity },
      status: "requested",
    },
    select: airportView,
    take: 30, orderBy: { pickupAt: "asc" },
  }) : [];
  return { eligible, rideService: driver.rideService, assigned: assigned.map((ride) => ({
    ...ride, navigation: navigationFor(ride),
  })), requests };
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
  const pickupNote = optionalText(body.pickupNote, "Pickup instructions", 120);
  const addressPin = optionalPin(body.addressPin);
  const airportLocation = getAirportByCode(airport.toUpperCase())!;
  const airportPin = optionalPin(body.airportPin) ?? airportLocation;
  if (!nearAirport(airportPin, airportLocation)) {
    throw new DriverError(400, "AIRPORT_PIN_OUTSIDE_AREA", "Choose an airport pin near the selected airport.");
  }
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
      passengerId, pickupAt: { gt: now }, status: { in: ["requested", "confirmed"] },
    } });
    if (pending >= 5) throw new DriverError(429, "TRANSFER_LIMIT", "Resolve an existing transfer before sending another request.");
    return tx.airportTransfer.create({
      data: {
        passengerId, requestKey, airport, direction, address, contactPhone, pickupAt, passengers, flight, luggage, pickupNote,
        addressLat: addressPin?.lat, addressLng: addressPin?.lng, airportLat: airportPin.lat, airportLng: airportPin.lng,
      },
      select: airportView,
    });
  });
}

export async function passengerAirportTransfers(passengerId: string) {
  const requests = await db.airportTransfer.findMany({
    where: { passengerId },
    select: { ...airportView, ...navigationView, ...trackingView, driver: { select: { name: true, phone: true, plate: true } } },
    orderBy: { pickupAt: "desc" }, take: 30,
  });
  return requests.map(({ driver, driverLat, driverLng, driverSeenAt, etaSeconds, ...request }) => {
    const active = request.status === "confirmed" || request.status === "in_progress";
    const fresh = active && driverSeenAt && Date.now() - driverSeenAt.getTime() <= POSITION_FRESHNESS_MS;
    const elapsedSeconds = driverSeenAt ? Math.max(0, Math.floor((Date.now() - driverSeenAt.getTime()) / 1000)) : 0;
    return {
      ...request,
      navigation: navigationFor(request),
      driver: active ? driver : null,
      position: fresh && driverLat !== null && driverLng !== null
        ? { lat: driverLat, lng: driverLng, seenAt: driverSeenAt,
            etaSeconds: request.status === "confirmed" && request.arrivedAt ? null
              : etaSeconds === null ? null : Math.max(0, etaSeconds - elapsedSeconds) }
        : null,
    };
  });
}

export async function acceptAirportTransfer(driverId: string, id: string) {
  await db.$transaction(async tx => {
    const driver = await lockDriver(tx, driverId);
    if (!AIRPORT_SERVICES.includes(driver.rideService)) throw new DriverError(403, "AIRPORT_DISABLED", "Enable airport rides first.");
    const now = new Date();
    const ride = await tx.airportTransfer.findFirst({
      where: { id, status: "requested", pickupAt: { gt: now }, passengers: { lte: driver.capacity } },
      select: { id: true, pickupAt: true },
    });
    if (!ride) throw stale();
    await ensureSlot(tx, driverId, driver.rideService, ride);
    const result = await tx.airportTransfer.updateMany({
      where: { id, status: "requested", pickupAt: { gt: new Date() } },
      data: { driverId, status: "confirmed" },
    });
    if (!result.count) throw stale();
  });
  return driverAirportTransfers(driverId);
}

export async function cancelPassengerAirportTransfer(passengerId: string, id: string) {
  const result = await db.airportTransfer.updateMany({
    where: { id, passengerId, status: { in: ["requested", "confirmed"] } },
    data: { status: "cancelled" },
  });
  if (!result.count) throw stale();
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
    const ride = await tx.airportTransfer.findFirst({ where: { id, driverId }, select: { status: true, pickupAt: true, arrivedAt: true } });
    if (!ride) throw stale();
    if (action === "arrive" && ride.status === "confirmed" && now >= airportWindow(ride.pickupAt).start) {
      if (!ride.arrivedAt) {
        const result = await tx.airportTransfer.updateMany({
          where: { id, driverId, status: "confirmed" },
          data: { arrivedAt: now, etaSeconds: null },
        });
        if (!result.count) throw stale();
      }
      return;
    }
    let status: string;
    if (action === "start" && ride.status === "confirmed" && now >= airportWindow(ride.pickupAt).start) {
      status = "in_progress";
    } else if (action === "complete" && ride.status === "in_progress") {
      status = "completed";
    } else if (action === "cancel" && ride.status === "confirmed") {
      status = "cancelled";
    } else throw new DriverError(409, "INVALID_ACTION", "This action is unavailable for the current transfer.");
    const result = await tx.airportTransfer.updateMany({
      where: { id, driverId, status: ride.status },
      data: { status, ...clearedTracking },
    });
    if (!result.count) throw stale();
  });
  return driverAirportTransfers(driverId);
}


export async function reportAirportTransferPosition(driverId: string, id: string, body: Record<string, unknown>) {
  const { leg, recordedAt: sampledAt, etaSeconds: eta } = body;
  const location = { lat: body.lat, lng: body.lng };
  if (!isTransferPin(location) || (leg !== "pickup" && leg !== "dropoff")) {
    throw new DriverError(400, "INVALID_POSITION", "The reported transfer position is invalid.");
  }
  const now = new Date();
  const recordedAt = typeof sampledAt === "string" ? new Date(sampledAt) : new Date(NaN);
  const age = now.getTime() - recordedAt.getTime();
  if (!Number.isFinite(age) || age < -30_000 || age > POSITION_FRESHNESS_MS) {
    throw new DriverError(400, "INVALID_POSITION", "The reported position is out of date.");
  }
  if (eta != null && (typeof eta !== "number" || !Number.isSafeInteger(eta) || eta < 0 || eta > 21_600)) {
    throw new DriverError(400, "INVALID_ETA", "The reported ETA is invalid.");
  }
  const status = leg === "pickup" ? "confirmed" : "in_progress";
  const ride = await db.airportTransfer.findFirst({
    where: { id, driverId, status },
    select: { pickupAt: true },
  });
  if (!ride) throw stale();
  const window = airportWindow(ride.pickupAt);
  if (now < window.start || (leg === "pickup" && now > window.end)) throw stale();
  await db.airportTransfer.updateMany({
    where: { id, driverId, status, OR: [
      { driverSeenAt: null }, { driverSeenAt: { lte: new Date(recordedAt.getTime() - POSITION_INTERVAL_MS) } },
    ] },
    data: { driverLat: location.lat, driverLng: location.lng, driverSeenAt: recordedAt, etaSeconds: typeof eta === "number" ? eta : null },
  });
  return { ok: true };
}
