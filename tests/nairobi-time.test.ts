import { describe, expect, it } from "vitest";
import { nairobiDate, nairobiDayRange, nairobiEventAt, nairobiTrainArrivalAt } from "@/lib/nairobi-time";
describe("Mombasa scheduling", () => {
  it("queries a Kenya day using UTC instants", () => {
    const day = nairobiDayRange("2026-10-04");
    expect(day.start.toISOString()).toBe("2026-10-03T21:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-04T21:00:00.000Z");
  });
  it("uses Kenya's date at the UTC midnight boundary", () => {
    expect(nairobiDate(new Date("2026-10-03T22:00:00Z"))).toBe("2026-10-04");
    expect(nairobiEventAt(new Date("2026-10-03T22:00:00Z"), 0, "08:00").toISOString()).toBe("2026-10-04T05:00:00.000Z");
  });
  it("handles next-day events and rejects rolled-over dates", () => {
    expect(nairobiEventAt(new Date("2026-12-31T12:00:00Z"), 1, "03:55").toISOString()).toBe("2027-01-01T00:55:00.000Z");
    expect(nairobiTrainArrivalAt(new Date("2026-10-03T12:00:00Z"), 0, 1, "03:55").toISOString()).toBe("2026-10-04T00:55:00.000Z");
    expect(() => nairobiDayRange("2026-02-30")).toThrow();
    expect(() => nairobiDayRange("bad")).toThrow();
    expect(() => nairobiEventAt(new Date(), 0, "25:70")).toThrow();
    expect(() => nairobiTrainArrivalAt(new Date(), 0, -1, "03:55")).toThrow();
  });
});

