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
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
