import { describe, expect, it } from "vitest";
import { addNairobiDays, nairobiDate, nairobiDayRange, nairobiEventAt, nairobiTrainArrivalAt, nairobiWeekday } from "@/lib/nairobi-time";
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
  it("computes Kenya service weekdays and date offsets independently of host timezone", () => {
    expect(nairobiWeekday("2026-10-18")).toBe(0); // Sunday
    expect(nairobiWeekday("2026-10-19")).toBe(1); // Monday
    expect(addNairobiDays("2026-10-18", -1)).toBe("2026-10-17");
    expect(addNairobiDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(() => nairobiWeekday("2026-02-30")).toThrow();
    expect(() => addNairobiDays("2026-10-18", 0.5)).toThrow();
  });
});

