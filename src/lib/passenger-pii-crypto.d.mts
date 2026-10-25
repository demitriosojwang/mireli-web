import type { Buffer } from "node:buffer";

export const ENVELOPE_PREFIX: string;
export function isEncryptedPassengerIdNumber(value: string | null | undefined): boolean;
export function encryptPassengerIdNumberWithKey(value: string, key: Buffer): string;
export function decryptPassengerIdNumberWithKey(value: string, key: Buffer): string;
