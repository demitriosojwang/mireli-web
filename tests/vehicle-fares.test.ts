import { describe, expect, it } from "vitest";
import {
  calculateVehicleBookingFee,
  getApprovedMotorbikeFare,
  getApprovedTuktukFare,
  getStageFareForVehicle,
  isPerRideVehicle,
} from "@/lib/vehicle-fares";

describe("approved fares by vehicle type", () => {
  it("uses the exact owner-provided per-ride motorbike and tuk-tuk schedules", () => {
    expect(getApprovedMotorbikeFare("Mtwapa")).toBe(1500);
    expect(getApprovedMotorbikeFare("Kora Kiembeni")).toBe(1000);
    expect(getApprovedTuktukFare("Mtwapa")).toBe(2000);
    expect(getApprovedTuktukFare("Bamburi Fisheries")).toBe(1500);
    expect(getApprovedTuktukFare("Diani Naivas")).toBe(2000);
  });

  it("keeps the standard hailed rate for 4/7 seats and reduces 10/11-seat driver fare by KSh 50", () => {
    const quote = (capacity: number) => getStageFareForVehicle({
      stageName: "Mtwapa",
      cabType: "Van",
      capacity,
      fallbackFare: 999,
    });

    expect(quote(4)).toBe(400);
    expect(quote(7)).toBe(400);
    expect(quote(10)).toBe(350);
    expect(quote(11)).toBe(350);
    expect(quote(8)).toBeNull();
  });

  it("charges KSh 100 once for each per-ride vehicle and KSh 60 per hailed seat", () => {
    expect(isPerRideVehicle("motorbike")).toBe(true);
    expect(isPerRideVehicle("tuk-tuk")).toBe(true);
    expect(calculateVehicleBookingFee({ cabType: "Motorbike", configuredPerSeatFee: 60, seats: 1, charter: false })).toBe(100);
    expect(calculateVehicleBookingFee({ cabType: "Tuk-tuk", configuredPerSeatFee: 60, seats: 1, charter: false })).toBe(100);
    expect(calculateVehicleBookingFee({ cabType: "Car", configuredPerSeatFee: 60, seats: 2, charter: false })).toBe(120);
    expect(calculateVehicleBookingFee({ cabType: "Van", configuredPerSeatFee: 60, seats: 1, charter: true })).toBe(60);
  });
});
