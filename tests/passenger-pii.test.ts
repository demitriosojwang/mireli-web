import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPassengerPiiEncryptionReady,
  decryptPassengerIdNumber,
  encryptPassengerIdNumber,
  isEncryptedPassengerIdNumber,
} from "@/lib/passenger-pii";

const TEST_KEY = "0123456789abcdef".repeat(4);

afterEach(() => vi.unstubAllEnvs());

describe("passenger ID encryption", () => {
  it("encrypts with authenticated encryption and decrypts for an authorized flow", () => {
    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", TEST_KEY);
    const encrypted = encryptPassengerIdNumber("12345678");

    expect(encrypted).not.toContain("12345678");
    expect(isEncryptedPassengerIdNumber(encrypted)).toBe(true);
    expect(decryptPassengerIdNumber(encrypted)).toBe("12345678");
    expect(encryptPassengerIdNumber("12345678")).not.toBe(encrypted);
  });

  it("retains a legacy plaintext read path during database backfill", () => {
    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", "");

    expect(decryptPassengerIdNumber("12345678")).toBe("12345678");
    expect(encryptPassengerIdNumber("12345678")).toBeTruthy();
  });

  it("rejects an absent key in strict production mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MIRELI_DEMO_MODE", "false");
    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", "");

    expect(assertPassengerPiiEncryptionReady).toThrow(/not configured/);
  });

  it("rejects malformed keys and tampered ciphertext", () => {
    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", "too-short");
    expect(() => encryptPassengerIdNumber("12345678")).toThrow(/64 hexadecimal/);

    vi.stubEnv("PASSENGER_PII_ENCRYPTION_KEY", TEST_KEY);
    const encrypted = encryptPassengerIdNumber("12345678")!;
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptPassengerIdNumber(tampered)).toThrow(/could not be decrypted/);
  });
});
