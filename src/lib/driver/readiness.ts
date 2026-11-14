import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {POLICY_VERSION} from "./catalogue";
import {navigationRoutingConfigured} from "./navigation";
import {emailSignInConfigured} from "./email";
import {amazonLocationConfigured} from "./amazon-location";

// Verified staff authentication ships with this release: src/lib/staff/auth.ts
// requires an emailed six-digit challenge, a TOTP second factor sealed with
// STAFF_MFA_ENCRYPTION_KEY, and a hashed session token, and /api/admin/auth
// delegates to it whenever the app is not the local demo. Intake still stays
// closed unless every other requirement below is satisfied at runtime, so this
// flag alone cannot open registration.
const productionReviewerAuthenticationImplemented = true;

export function securePolicyUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;}
  catch {return false;}
}

/** Existing drivers can authenticate when SMS and the token/challenge secret are configured. */
export function driverPhoneSignInConfigured(): boolean {
  if (isLocalDemoEnabled()) return true;
  return (process.env.DRIVER_AUTH_SECRET?.length ?? 0) >= 32 &&
    !!process.env.AT_USERNAME && !!process.env.AT_API_KEY;
}

/** Configuration readiness is not proof of provider delivery or operational approval. */
export function driverRegistrationConfigured(): boolean {
  if (isLocalDemoEnabled()) return true;
  const scanner = process.env.DRIVER_SCAN_COMMAND;
  const reviewers = process.env.DRIVER_COMPLIANCE_REVIEWERS?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  return productionReviewerAuthenticationImplemented && !!scanner && scanner.startsWith("/") && reviewers.length > 0 &&
    (emailSignInConfigured() || driverPhoneSignInConfigured()) &&
    !!process.env.AWS_REGION && !!process.env.DRIVER_DOCUMENT_BUCKET &&
    process.env.DRIVER_POLICY_VERSION === POLICY_VERSION &&
    securePolicyUrl(process.env.DRIVER_PRIVACY_URL) && securePolicyUrl(process.env.DRIVER_TERMS_URL);
}

export function driverServiceStatus() {
  const phoneSignInOpen=driverPhoneSignInConfigured();
  const emailSignInOpen=isLocalDemoEnabled() || emailSignInConfigured();
  const registrationOpen=driverRegistrationConfigured();
  return {apiVersion: "v1", driverEntryIntent: true, simulation: isLocalDemoEnabled(), phoneSignInOpen,emailSignInOpen, registrationOpen,
    navigationOpen:navigationRoutingConfigured(), destinationSearchOpen:amazonLocationConfigured(), satelliteOpen:amazonLocationConfigured(),
    supportEmail: "mirelisgr001@gmail.com",
    message: !phoneSignInOpen && !emailSignInOpen ? "Driver email sign-in is not configured yet." :
      !registrationOpen ? "Existing drivers can sign in. New driver applications are paused." :
      "Verify your email to apply or sign in."};
}
