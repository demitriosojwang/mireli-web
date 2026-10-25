import { describe, expect, it } from "vitest";
import { getBookingCatalogueView, getCabAvailabilityCountLabel, hasPublishedCustomerPoints, shouldLoadTrainTimetable } from "@/lib/booking-catalogue";

describe("customer booking catalogue state", () => {
  it("shows a compact checking state while approved stops load", () => {
    expect(getBookingCatalogueView("loading", 0)).toBe("checking");
    expect(shouldLoadTrainTimetable("loading")).toBe(false);
  });

  it("closes booking when stops are empty but still loads the timetable", () => {
    expect(getBookingCatalogueView("empty", 0)).toBe("closed");
    expect(getBookingCatalogueView("ready", 0)).toBe("closed");
    expect(shouldLoadTrainTimetable("empty")).toBe(true);
    expect(shouldLoadTrainTimetable("ready")).toBe(true);
  });

  it("fails closed for invalid stop counts", () => {
    expect(hasPublishedCustomerPoints(-1)).toBe(false);
    expect(hasPublishedCustomerPoints(Number.NaN)).toBe(false);
    expect(getBookingCatalogueView("ready", -1)).toBe("closed");
    expect(shouldLoadTrainTimetable("ready")).toBe(true);
  });

  it("shows booking controls when stops are published and still loads trains", () => {
    expect(getBookingCatalogueView("ready", 3)).toBe("booking");
    expect(shouldLoadTrainTimetable("ready")).toBe(true);
  });

  it("keeps search and train recovery available after a catalogue error", () => {
    expect(getBookingCatalogueView("error", 0)).toBe("booking");
    expect(shouldLoadTrainTimetable("error")).toBe(true);
  });

  it("distinguishes confirmed zero cabs from unavailable availability", () => {
    expect(getCabAvailabilityCountLabel({
      loading: false, status: "error", hasEligibleDrivers: false, cabCount: 0, hasSelectedPoint: true,
    })).toBe("Unavailable");
    expect(getCabAvailabilityCountLabel({
      loading: false, status: "empty", hasEligibleDrivers: false, cabCount: 0, hasSelectedPoint: true,
    })).toBe("0 cabs");
  });

  it("does not carry a previous cab count after the passenger clears the stop", () => {
    expect(getCabAvailabilityCountLabel({
      loading: false, status: "loading", hasEligibleDrivers: null, cabCount: 0, hasSelectedPoint: false,
    })).toBe("Choose a stop");
  });
});
