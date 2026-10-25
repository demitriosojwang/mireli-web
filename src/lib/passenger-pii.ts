import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isLocalDemoEnabled } from "./runtime-mode";

const ENVELOPE_PREFIX = "mireli-pii:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

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
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt an ID/passport number before it is written to the database. */
export function encryptPassengerIdNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (isEncryptedPassengerIdNumber(value)) {
    throw new Error("Passenger identity value is already encrypted.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/**
 * Decrypt values for an authorized passenger flow. Plaintext is accepted only
 * as a legacy-read path so old rows remain available during the backfill.
 */
export function decryptPassengerIdNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!isEncryptedPassengerIdNumber(value)) return value;

  try {
    const [ivPart, tagPart, ciphertextPart, ...extra] = value.slice(ENVELOPE_PREFIX.length).split(".");
    if (!ivPart || !tagPart || !ciphertextPart || extra.length > 0) throw new Error("Invalid envelope");
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
      throw new Error("Invalid envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof PassengerPiiConfigurationError) throw error;
    throw new Error("Passenger identity data could not be decrypted.");
  }
}
