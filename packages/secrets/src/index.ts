// Secret encryption for credentials stored in Postgres (ADR-0009, data model:
// LlmProvider(config, secretRef)). Shared by apps/api (registry management) and
// services/runtime (the launcher resolving job credentials).
// The master key comes from the installation environment (deploy/compose/.env.example
// → KINTSUGI_SECRET_KEY) — deployment configuration, never provider configuration.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function masterKey(): Buffer {
  const raw = process.env["KINTSUGI_SECRET_KEY"];
  if (raw === undefined || raw.length === 0) {
    throw new Error("KINTSUGI_SECRET_KEY is not set; generate one with `openssl rand -base64 32` (see deploy/compose/.env.example)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("KINTSUGI_SECRET_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const iv = Buffer.from(secret.iv, "base64");
  const authTag = Buffer.from(secret.authTag, "base64");
  // GCM accepts a truncated tag and checks only the bytes it is given: every stored tag is the full 16 bytes.
  if (iv.length !== IV_BYTES) throw new Error(`Encrypted secret is malformed: the IV must be ${IV_BYTES} bytes`);
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error(`Encrypted secret is malformed: the auth tag must be ${AUTH_TAG_BYTES} bytes`);
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
