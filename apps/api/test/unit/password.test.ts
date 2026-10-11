import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "#common/security/password.js";

describe("password hashing", () => {
  it("hashes with argon2id at the OWASP baseline, salt inside the PHC string", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored.salt).toBe("");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
    expect(needsRehash(stored)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    expect((await hashPassword("same")).hash).not.toBe((await hashPassword("same")).hash);
  });

  it("verifies legacy scrypt hashes and flags them for rehash", async () => {
    const salt = "c2FsdA==";
    const legacy = { hash: scryptSync("old secret", salt, 32).toString("base64"), salt };
    expect(await verifyPassword("old secret", legacy)).toBe(true);
    expect(await verifyPassword("other", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("flags argon2 hashes made with other parameters", () => {
    const weak = { hash: "$argon2id$v=19$m=4096,t=3,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA", salt: "" };
    expect(needsRehash(weak)).toBe(true);
  });
});
