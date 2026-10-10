// Shared kernel: password hashing (scrypt) for local sign-in (ADR-0008).
// Format-independent: callers store { hash, salt } as text columns. Async so a burst
// of sign-ins never blocks the event loop.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const KEY_LENGTH = 32;
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export interface PasswordHash {
  hash: string;
  salt: string;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16).toString("base64");
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)).toString("base64");
  return { hash, salt };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await scryptAsync(password, stored.salt, KEY_LENGTH);
  const expected = Buffer.from(stored.hash, "base64");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** A throwaway hash: verifying against it costs the same as a real check (no user enumeration by timing). */
export const DUMMY_PASSWORD_HASH: Promise<PasswordHash> = hashPassword(randomBytes(16).toString("base64"));
