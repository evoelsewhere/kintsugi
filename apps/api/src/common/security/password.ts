// Shared kernel: password hashing for local sign-in (ADR-0008: argon2id).
//
// New hashes are argon2id PHC strings (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`) — the
// salt and parameters live inside the string, so `salt` is empty. Hashes written
// before argon2id are scrypt { hash, salt } pairs: they still verify, and
// `needsRehash` tells the sign-in flow to replace them with argon2id once the
// plaintext is known (no bulk migration possible without it).

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { type Algorithm, hash as argon2Hash, parseOptions, verify as argon2Verify } from "@node-rs/argon2";

/** OWASP baseline for argon2id: 19 MiB, 2 passes, 1 lane. */
const ARGON2ID = 2 as Algorithm;
const ARGON2_OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const LEGACY_SCRYPT_KEY_LENGTH = 32;
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export interface PasswordHash {
  /** argon2id PHC string, or a base64 scrypt digest for legacy hashes. */
  hash: string;
  /** Empty for argon2id (the salt is inside the PHC string); base64 salt for legacy scrypt. */
  salt: string;
}

const isArgon2 = (stored: PasswordHash): boolean => stored.hash.startsWith("$argon2");

export async function hashPassword(password: string): Promise<PasswordHash> {
  return { hash: await argon2Hash(password, ARGON2_OPTIONS), salt: "" };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (isArgon2(stored)) return argon2Verify(stored.hash, password);
  const candidate = await scryptAsync(password, stored.salt, LEGACY_SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(stored.hash, "base64");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** True for legacy scrypt hashes and for argon2 hashes made with other parameters. */
export function needsRehash(stored: PasswordHash): boolean {
  if (!isArgon2(stored)) return true;
  const options = parseOptions(stored.hash);
  return (
    options.algorithm !== ARGON2_OPTIONS.algorithm ||
    options.memoryCost !== ARGON2_OPTIONS.memoryCost ||
    options.timeCost !== ARGON2_OPTIONS.timeCost ||
    options.parallelism !== ARGON2_OPTIONS.parallelism
  );
}

/** A throwaway hash: verifying against it costs the same as a real check (no user enumeration by timing). */
export const DUMMY_PASSWORD_HASH: Promise<PasswordHash> = hashPassword(randomBytes(16).toString("base64"));
