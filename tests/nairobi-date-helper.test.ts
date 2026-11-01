import { describe, expect, it } from "vitest";
import { nairobiToday } from "@/lib/nairobi-time";

describe("Nairobi booking dates", () => {
  it("keeps Today and Tomorrow aligned across UTC midnight", () => {
    const now = new Date("2026-10-15T23:21:44.000Z");

    expect(nairobiToday(0, now)).toBe("2026-10-16");
    expect(nairobiToday(1, now)).toBe("2026-10-17");
  });

  it("does not depend on the device timezone when the local date differs", () => {
    const now = new Date("2026-10-15T20:30:00.000Z");

    expect(nairobiToday(0, now)).toBe("2026-10-15");
    expect(nairobiToday(1, now)).toBe("2026-10-16");
  });
});
