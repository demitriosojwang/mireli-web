import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  booking: vi.fn(), stage: vi.fn(), session: vi.fn(), eta: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { booking: { findFirst: mocks.booking }, routeStage: { findFirst: mocks.stage } },
}));
vi.mock("@/lib/session", () => ({ getPassengerSession: mocks.session }));
vi.mock("@/lib/passenger-pickup-eta", () => ({ passengerPickupEta: mocks.eta }));

import { GET } from "@/app/api/bookings/[id]/track/route";
import { PASSENGER_TERMINUS } from "@/lib/passenger-terminus";

const request = (eta = false) => GET(new Request(
  "https://mireli.test/api/bookings/b1/track" + (eta ? "?eta=1" : "")
), { params: Promise.resolve({ id: "b1" }) });
const trip = () => ({
  id: "trip-1", driverId: "driver-1", driver: { status: "active" },
  status: "scheduled", departureAt: new Date(),
  driverPosition: { driverId: "driver-1", lat: -4.05, lng: 39.66, recordedAt: new Date() },
});
const booking = (override = {}) => ({
  status: "confirmed", code: "MR-TEST1", routeId: "route-1", stageId: "stage-1",
  direction: "FROM_TERMINUS", homePickup: false, trip: trip(), ...override,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "passenger-1" });
  mocks.eta.mockResolvedValue(190);
});

describe("booking live tracking", () => {
  it("requires a passenger session and restricts the database lookup to that passenger", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    expect(mocks.booking).not.toHaveBeenCalled();

    mocks.booking.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.booking.mock.calls[0][0].where).toEqual({ id: "b1", passengerId: "passenger-1" });
  });

  it.each(["awaiting_payment", "cancelled", "completed"])("withholds GPS for a %s booking", async status => {
    mocks.booking.mockResolvedValue(booking({ status }));
    expect(await (await request(true)).json()).toMatchObject({ phase: "unavailable", cab: null, etaSeconds: null });
    expect(mocks.eta).not.toHaveBeenCalled();
  });

  it("uses Mombasa Terminus as pickup for an outbound ride and fetches ETA only on the slower poll", async () => {
    mocks.booking.mockResolvedValue(booking({ homePickup: true }));
    const fast = await request();
    expect(fast.headers.get("cache-control")).toBe("private, no-store");
    expect(await fast.json()).toMatchObject({
      pickup: { name: PASSENGER_TERMINUS.name, lat: PASSENGER_TERMINUS.lat, lng: PASSENGER_TERMINUS.lng },
      cab: { lat: -4.05, lng: 39.66 }, etaSeconds: null,
    });
    expect(mocks.eta).not.toHaveBeenCalled();
    const body = await (await request(true)).json();
    expect(body.etaSeconds).toBe(190);
    expect(JSON.stringify(body)).not.toMatch(/driver-1|trip-1/);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("estimates a ride to the terminus using a pickup stop on the booked route", async () => {
    mocks.booking.mockResolvedValue(booking({ direction: "TO_TERMINUS" }));
    mocks.stage.mockResolvedValue({ name: "Nyali", lat: -4.03, lng: 39.69 });
    expect(await (await request(true)).json()).toMatchObject({
      pickup: { name: "Nyali" }, canEstimatePickup: true, etaSeconds: 190,
    });
    expect(mocks.stage.mock.calls[0][0].where).toEqual({ id: "stage-1", routeId: "route-1" });
  });

  it("keeps a home address without a verified pin out of the ETA request", async () => {
    mocks.booking.mockResolvedValue(booking({ direction: "TO_TERMINUS", homePickup: true }));
    expect(await (await request(true)).json()).toMatchObject({ pickup: null, canEstimatePickup: false });
    expect(mocks.stage).not.toHaveBeenCalled();
    expect(mocks.eta).not.toHaveBeenCalled();
  });

  it.each([
    { recordedAt: new Date(Date.now() - 61_000) },
    { driverId: "previous-driver" },
  ])("drops stale or reassigned cab positions", async override => {
    const assigned = trip();
    mocks.booking.mockResolvedValue(booking({ trip: { ...assigned, driverPosition: { ...assigned.driverPosition, ...override } } }));
    expect(await (await request(true)).json()).toMatchObject({ cab: null, etaSeconds: null });
  });

  it("stops pickup estimates for passengers already on board", async () => {
    mocks.booking.mockResolvedValue(booking({ status: "boarded", trip: { ...trip(), status: "departed" } }));
    expect(await (await request(true)).json()).toMatchObject({ phase: "on_the_road", cab: { lat: -4.05 }, etaSeconds: null });
    expect(mocks.eta).not.toHaveBeenCalled();
  });

  it("shows assignment pending for a confirmed booking without an active driver", async () => {
    mocks.booking.mockResolvedValue(booking({ trip: null }));
    expect(await (await request()).json()).toMatchObject({ phase: "no_trip", cab: null });
  });
});
