import { describe, expect, it } from "vitest";
import {
  hasCompleteOffstageStageLocations,
  isMombasaCoastLocation,
  nearestOffstageStage,
  type OffstageStage,
} from "@/lib/offstage-quote-core";

const stage = (overrides: Partial<OffstageStage> = {}): OffstageStage => ({
  id: "stage-1",
  routeId: "route-1",
  name: "Mombasa stage",
  order: 1,
  lat: -4.05,
  lng: 39.65,
  fare: 400,
  homeSurcharge: 0,
  ...overrides,
});

describe("off-stage quote geospatial checks", () => {
  it("accepts locations within the configured Mombasa coast service bounds", () => {
    expect(isMombasaCoastLocation({ latitude: -4.05, longitude: 39.65 })).toBe(true);
    expect(isMombasaCoastLocation({ latitude: -5, longitude: 39.65 })).toBe(false);
  });

  it("requires every customer stage to have a named, in-bounds location and positive fare", () => {
    expect(hasCompleteOffstageStageLocations([stage()])).toBe(true);
    expect(hasCompleteOffstageStageLocations([stage({ lat: Number.NaN })])).toBe(false);
    expect(hasCompleteOffstageStageLocations([stage({ lng: 0 })])).toBe(false);
    expect(hasCompleteOffstageStageLocations([stage({ fare: 0 })])).toBe(false);
    expect(hasCompleteOffstageStageLocations([stage({ order: 0 })])).toBe(false);
  });

  it("selects the geographically nearest approved customer stage", () => {
    const nearer = stage({ id: "stage-near", name: "Near", lng: 39.70 });
    const farther = stage({ id: "stage-far", name: "Far", lng: 39.55 });

    expect(nearestOffstageStage([farther, nearer], { latitude: -4.05, longitude: 39.695 })).toEqual(nearer);
  });

  it("fails closed for out-of-area addresses or incomplete stage catalogues", () => {
    expect(nearestOffstageStage([stage()], { latitude: -5, longitude: 39.65 })).toBeNull();
    expect(nearestOffstageStage([stage({ lat: 0, lng: 0 })], { latitude: -4.05, longitude: 39.65 })).toBeNull();
  });
});
