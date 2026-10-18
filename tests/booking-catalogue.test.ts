import { describe, expect, it } from "vitest";
import { getBookingCatalogueView, hasPublishedCustomerPoints, shouldLoadTrainTimetable } from "@/lib/booking-catalogue";

describe("customer booking catalogue state", () => {
  it("shows a compact checking state while approved stops load", () => {
    expect(getBookingCatalogueView("loading", 0)).toBe("checking");
    expect(shouldLoadTrainTimetable("loading", 0)).toBe(false);
  });

  it("closes the booking form and skips timetable traffic when the catalogue is empty", () => {
    expect(getBookingCatalogueView("empty", 0)).toBe("closed");
    expect(getBookingCatalogueView("ready", 0)).toBe("closed");
    expect(shouldLoadTrainTimetable("empty", 0)).toBe(false);
    expect(shouldLoadTrainTimetable("ready", 0)).toBe(false);
  });

  it("fails closed for invalid stop counts", () => {
    expect(hasPublishedCustomerPoints(-1)).toBe(false);
    expect(hasPublishedCustomerPoints(Number.NaN)).toBe(false);
    expect(getBookingCatalogueView("ready", -1)).toBe("closed");
    expect(shouldLoadTrainTimetable("ready", Number.NaN)).toBe(false);
  });

  it("shows booking controls and loads trains only when stops are published", () => {
    expect(getBookingCatalogueView("ready", 3)).toBe("booking");
    expect(shouldLoadTrainTimetable("ready", 3)).toBe(true);
  });

  it("keeps search and train recovery available after a catalogue error", () => {
    expect(getBookingCatalogueView("error", 0)).toBe("booking");
    expect(shouldLoadTrainTimetable("error", 0)).toBe(true);
  });
});
