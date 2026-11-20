import { beforeEach, expect, it, vi } from "vitest";

const { calculateServiceRoute } = vi.hoisted(() => ({ calculateServiceRoute: vi.fn() }));
vi.mock("@/lib/driver/navigation", () => ({
  navigationRoutingConfigured: () => true,
  calculateServiceRoute,
}));

import { passengerTrackingRoute } from "@/lib/passenger-pickup-eta";

const origin = { lat: -4.05, lng: 39.66 };
const destination = { lat: -4.03, lng: 39.69 };
const coordinates = [[39.66, -4.05], [39.69, -4.03]];

beforeEach(() => {
  calculateServiceRoute.mockReset();
});

it("converts Valhalla geometry to longitude-first coordinates", async () => {
  calculateServiceRoute.mockResolvedValue({ geometry: "~cevF_}ssjA_af@_ry@", durationSeconds: 180 });
  expect(await passengerTrackingRoute("valhalla", origin, destination)).toEqual({ coordinates, durationSeconds: 180 });
});

it("reuses the cached route for a trip and keeps different targets independent", async () => {
  calculateServiceRoute.mockResolvedValue({ points: coordinates, durationSeconds: 180 });
  const route = await passengerTrackingRoute("amazon", origin, destination);
  expect(await passengerTrackingRoute("amazon", origin, destination)).toBe(route);
  expect(route?.coordinates).toEqual(coordinates);
  await passengerTrackingRoute("amazon", origin, { ...destination, lat: -4.02 });
  expect(calculateServiceRoute).toHaveBeenCalledTimes(2);
});
