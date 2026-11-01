import { createHash } from "node:crypto";
import { isLocalDemoEnabled } from "./runtime-mode";
import {
  decryptPassengerIdNumberWithKey,
  encryptPassengerIdNumberWithKey,
  isEncryptedPassengerIdNumber as isEncryptedEnvelope,
} from "./passenger-pii-crypto.mjs";

export class PassengerPiiConfigurationError extends Error {
  constructor(message = "Passenger identity encryption is not configured.") {
    super(message);
    this.name = "PassengerPiiConfigurationError";
  }
}

function encryptionKey(): Buffer {
  const configured = process.env.PASSENGER_PII_ENCRYPTION_KEY?.trim();
  if (configured) {
    if (!/^[\da-fA-F]{64}$/.test(configured)) {
      throw new PassengerPiiConfigurationError(
        "PASSENGER_PII_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.",
      );
    }
    return Buffer.from(configured, "hex");
  }

  // Keep local demo data usable without allowing a production deployment to
  // silently encrypt identity data with a broadly reused session secret.
  if (isLocalDemoEnabled()) {
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) throw new PassengerPiiConfigurationError();
    return createHash("sha256")
      .update("mireli:passenger-pii:local-demo:v1:")
      .update(sessionSecret)
      .digest();
  }

  // Stable, isolated test key. This branch is unreachable in production.
  if (process.env.NODE_ENV === "test") {
    return createHash("sha256").update("mireli:passenger-pii:test-only:v1").digest();
  }

  throw new PassengerPiiConfigurationError();
}

export function assertPassengerPiiEncryptionReady(): void {
  encryptionKey();
}

export function isEncryptedPassengerIdNumber(value: string | null | undefined): boolean {
  return isEncryptedEnvelope(value);
}

/** Encrypt an ID/passport number before it is written to the database. */
export function encryptPassengerIdNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (isEncryptedPassengerIdNumber(value)) {
    throw new Error("Passenger identity value is already encrypted.");
  }

  return encryptPassengerIdNumberWithKey(value, encryptionKey());
}

/**
 * Decrypt values for an authorized passenger flow. Plaintext is accepted only
 * as a legacy-read path so old rows remain available during the backfill.
 */
export function decryptPassengerIdNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!isEncryptedPassengerIdNumber(value)) return value;

  try {
    return decryptPassengerIdNumberWithKey(value, encryptionKey());
  } catch (error) {
    if (error instanceof PassengerPiiConfigurationError) throw error;
    throw new Error("Passenger identity data could not be decrypted.");
  }
}
