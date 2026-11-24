import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), places: vi.fn(), route: vi.fn(), limits: vi.fn(), counter: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getPassengerSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.limits,
  driverRateLimit: { upsert: mocks.counter },
} }));
vi.mock("@/lib/driver/amazon-location", () => ({
  amazonLocationConfigured: () => true,
  calculateAmazonDriverRoute: mocks.route,
  searchDriverDestinations: mocks.places,
}));

import { POST } from "@/app/api/ride-map/route";

function request(body: object) {
  return new Request("https://mireli.online/api/ride-map", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

const station = { latitude: -4.02178, longitude: 39.57947 };
const hotel = { latitude: -4.035, longitude: 39.709 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ id: "passenger-1" });
  mocks.limits.mockResolvedValue([{ count: 1 }, { count: 1 }, { count: 1 }]);
});

describe("passenger map", () => {
  it("checks the passenger session and geographic bounds before routing", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "route", origin: station, destination: hotel }))).status).toBe(401);
    expect((await POST(request({ action: "route", origin: station, destination: { latitude: 51.5, longitude: 0 } }))).status).toBe(400);
    expect(mocks.route).not.toHaveBeenCalled();
  });

  it("filters search matches to the coast and never caches passenger addresses", async () => {
    const coastal = { ...hotel, id: "hotel" };
    mocks.places.mockResolvedValue({ places: [coastal, { latitude: -1.28, longitude: 36.81, id: "inland" }] });
    const result = await POST(request({ action: "places", query: "Coast hotel" }));
    expect(await result.json()).toEqual({ places: [coastal] });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rate-limits provider calls and returns only road preview data", async () => {
    mocks.limits.mockResolvedValueOnce([{ count: 9 }, { count: 1 }, { count: 1 }]);
    const body = { action: "route", origin: station, destination: hotel };
    expect((await POST(request(body))).status).toBe(429);
    expect(mocks.route).not.toHaveBeenCalled();
    const geometry = { points: [[station.longitude, station.latitude], [hotel.longitude, hotel.latitude]], distanceMeters: 18000, durationSeconds: 1860 };
    mocks.route.mockResolvedValue({ ...geometry, maneuvers: [{ instruction: "Start" }] });
    expect(await (await POST(request(body))).json()).toEqual(geometry);
    expect(mocks.route).toHaveBeenCalledWith(station, hotel, false);
  });
});
