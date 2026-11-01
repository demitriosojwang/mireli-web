import { describe, expect, it } from "vitest";
import { APPROVED_STAGE_FARES, getApprovedStageFare } from "@/lib/fare-catalogue";

describe("owner-approved stage fare sheet", () => {
  it("contains the 26 transcribed North and South Coast destinations", () => {
    expect(APPROVED_STAGE_FARES).toHaveLength(26);
    expect(APPROVED_STAGE_FARES.filter((stage) => stage.coast === "north")).toHaveLength(22);
    expect(APPROVED_STAGE_FARES.filter((stage) => stage.coast === "south")).toHaveLength(4);
  });

  it("looks up approved fares case-insensitively and supports legacy spelling variants", () => {
    expect(getApprovedStageFare("mtwapa")).toBe(400);
    expect(getApprovedStageFare("Naivas Bamburi")).toBe(400);
    expect(getApprovedStageFare("Diani Naivas")).toBe(500);
    expect(getApprovedStageFare("unknown stop")).toBeNull();
  });
});
