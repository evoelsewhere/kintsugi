import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialLockPipePath, credentialLockPort, withCredentialLock } from "../src/oauth-lock.js";

describe("OS credential mutex", () => {
  it("fails closed at its deadline when an unrelated listener owns the lock port", async () => {
    const account = `test-${randomUUID()}`;
    const port = credentialLockPort(account);
    expect(port).toBeGreaterThanOrEqual(49152);
    expect(port).toBeLessThanOrEqual(65535);
    expect(credentialLockPort(account)).toBe(port);
    const unrelated = createServer();
    unrelated.listen(port, "127.0.0.1");
    await once(unrelated, "listening");
    let invoked = false;
    try {
      await expect(withCredentialLock(account, async () => { invoked = true; }, { timeoutMs: 20 })).rejects.toMatchObject({ code: "CREDENTIAL_LOCK_TIMEOUT" });
      expect(invoked).toBe(false);
      expect(unrelated.listening).toBe(true);
    } finally { await new Promise<void>((resolve) => unrelated.close(() => resolve())); }
    await withCredentialLock(account, async () => { invoked = true; });
    expect(invoked).toBe(true);
  });

  it("derives a stable opaque named-pipe fallback per profile", () => {
    const account = `test-${randomUUID()}`;
    const path = credentialLockPipePath(account);
    expect(path.startsWith("\\\\.\\pipe\\kintsugi-caw-")).toBe(true);
    expect(credentialLockPipePath(account)).toBe(path);
    expect(credentialLockPipePath(account + "-other")).not.toBe(path);
  });

  it("cancels a waiting operation without taking or releasing another process's lock", async () => {
    const account = `test-${randomUUID()}`;
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const owner = withCredentialLock(account, async () => { acquired(); await gate; });
    await held;
    const controller = new AbortController();
    let invoked = false;
    const waiting = withCredentialLock(account, async () => { invoked = true; }, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
    expect(invoked).toBe(false);
    release(); await owner;
    await withCredentialLock(account, async () => { invoked = true; });
    expect(invoked).toBe(true);
  });

  it("releases the OS mutex when the protected operation rejects", async () => {
    const account = `test-${randomUUID()}`;
    await expect(withCredentialLock(account, async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    expect(await withCredentialLock(account, async () => "recovered")).toBe("recovered");
  });
});
