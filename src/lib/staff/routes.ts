import type { StaffRole } from "./config";

export function staffLandingPage(roles: readonly StaffRole[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("compliance")) return "/admin/driver-onboarding";
  if (roles.includes("finance")) return "/admin/driver-payout-destinations";
  return "/admin/login";
}
