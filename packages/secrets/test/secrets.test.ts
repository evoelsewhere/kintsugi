import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/index.js";

const saved = process.env["KINTSUGI_SECRET_KEY"];
beforeEach(() => {
  process.env["KINTSUGI_SECRET_KEY"] = randomBytes(32).toString("base64");
});
afterEach(() => {
  if (saved === undefined) delete process.env["KINTSUGI_SECRET_KEY"];
  else process.env["KINTSUGI_SECRET_KEY"] = saved;
});

const flip = (base64: string): string => {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = bytes[0]! ^ 0xff;
  return bytes.toString("base64");
};

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips and never stores the plaintext", () => {
    const encrypted = encryptSecret("sk-live-abc123");
    expect(JSON.stringify(encrypted)).not.toContain("sk-live-abc123");
    expect(decryptSecret(encrypted)).toBe("sk-live-abc123");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("same").ciphertext).not.toBe(encryptSecret("same").ciphertext);
  });

  it("rejects tampered ciphertext, IV or auth tag", () => {
    const encrypted = encryptSecret("sk-live-abc123");
    expect(() => decryptSecret({ ...encrypted, ciphertext: flip(encrypted.ciphertext) })).toThrow();
    expect(() => decryptSecret({ ...encrypted, iv: flip(encrypted.iv) })).toThrow();
    expect(() => decryptSecret({ ...encrypted, authTag: flip(encrypted.authTag) })).toThrow();
  });

  it("fails with another master key", () => {
    const encrypted = encryptSecret("sk-live-abc123");
    process.env["KINTSUGI_SECRET_KEY"] = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("requires a 32-byte base64 master key", () => {
    delete process.env["KINTSUGI_SECRET_KEY"];
    expect(() => encryptSecret("x")).toThrow(/KINTSUGI_SECRET_KEY is not set/);
    process.env["KINTSUGI_SECRET_KEY"] = randomBytes(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
