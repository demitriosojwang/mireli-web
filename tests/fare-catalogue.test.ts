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

  it("resolves the published Hailed Ride spellings and their earlier variants", () => {
    expect(getApprovedStageFare("Ananda Marga")).toBe(400);
    expect(getApprovedStageFare("Ananda Magaya")).toBe(400);
    expect(getApprovedStageFare("Kora Kiembeni")).toBe(400);
    expect(getApprovedStageFare("Kona Kiembeni")).toBe(400);
    expect(getApprovedStageFare("Mwambeni")).toBe(400);
    expect(getApprovedStageFare("Mwenbeni")).toBe(400);
    expect(getApprovedStageFare("ICC Junction")).toBe(400);
    expect(getApprovedStageFare("GCC Junction")).toBe(400);
  });

  it("prices the 26 published stops at the owner's driver fare per seat", () => {
    expect(getApprovedStageFare("Malindi")).toBe(700);
    expect(getApprovedStageFare("Changamwe")).toBe(200);
    expect(getApprovedStageFare("Mikindani")).toBe(250);
    expect(getApprovedStageFare("Miritini")).toBe(250);
    expect(getApprovedStageFare("Town (CBD) / Mwembe Tayari")).toBe(300);
  });
});
