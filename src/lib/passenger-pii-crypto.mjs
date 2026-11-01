import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENVELOPE_PREFIX = "mireli-pii:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function isEncryptedPassengerIdNumber(value) {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

export function encryptPassengerIdNumberWithKey(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid passenger identity key.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${ENVELOPE_PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptPassengerIdNumberWithKey(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid passenger identity key.");
  const [ivPart, tagPart, ciphertextPart, ...extra] = value.slice(ENVELOPE_PREFIX.length).split(".");
  if (!ivPart || !tagPart || !ciphertextPart || extra.length > 0) throw new Error("Invalid encrypted value.");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Invalid encrypted value.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
