// Shared kernel: password hashing (scrypt) for local sign-in (ADR-0008).
// Format-independent: callers store { hash, salt } as text columns.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

export interface PasswordHash {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16).toString("base64");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("base64");
  return { hash, salt };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  const candidate = scryptSync(password, stored.salt, KEY_LENGTH);
  const expected = Buffer.from(stored.hash, "base64");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
