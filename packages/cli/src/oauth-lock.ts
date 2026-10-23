import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { userInfo } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { CREDENTIAL_SERVICE } from "./credential-store.js";
import { CliError } from "./profile.js";

/**
 * Cross-process keyring mutex, v1. The key is the OS identity + keyring service/account,
 * never a credential or installation URL. Every platform first uses the IANA
 * dynamic/private unprivileged range 49152–65535; Windows falls back to an exclusive
 * named pipe only when the OS refuses that port. Hash collisions merely serialize
 * unrelated accounts.
 *
 * An exclusive OS listener is an OS-owned lease: process death releases it, including
 * an ungraceful crash. No secret, PID, lease file or stale-lock deletion is involved.
 * Never take over a busy endpoint: unrelated listeners fail closed at the deadline.
 * Keep the key and primary port derivation stable across CLI versions sharing a keyring.
 */
function credentialLockDigest(profileId: string): Buffer {
  const identity = userInfo();
  const key = ["v1", identity.username, identity.homedir, CREDENTIAL_SERVICE, profileId].join("\0");
  return createHash("sha256").update(key).digest();
}

export function credentialLockPort(profileId: string): number {
  return 49152 + credentialLockDigest(profileId).readUInt32BE(0) % 16384;
}

export function credentialLockPipePath(profileId: string): string {
  return `\\\\.\\pipe\\kintsugi-caw-${credentialLockDigest(profileId).toString("hex")}`;
}

function lockError(code: "CREDENTIAL_LOCK_UNAVAILABLE" | "CREDENTIAL_LOCK_TIMEOUT" | "CREDENTIAL_LOCK_RELEASE_FAILED"): CliError {
  return new CliError(code, "Could not exclusively access the Kintsugi credential store. Close other Kintsugi CLI connections and retry; a local port may be unavailable. No refresh was attempted without the lock.");
}

function cancelled(signal: AbortSignal): CliError {
  return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
    ? lockError("CREDENTIAL_LOCK_TIMEOUT")
    : new CliError("CANCELLED", "Credential operation cancelled");
}

type LockAddress = { port: number } | { path: string };
type LockAttempt = { kind: "acquired"; server: Server } | { kind: "busy" } | { kind: "denied" };

async function tryAcquire(address: LockAddress): Promise<LockAttempt> {
  const server = createServer((socket) => socket.destroy());
  return await new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve({ kind: "busy" });
      else if ("port" in address && ["EACCES", "EPERM", "EADDRNOTAVAIL"].includes(error.code ?? "")) resolve({ kind: "denied" });
      else reject(lockError("CREDENTIAL_LOCK_UNAVAILABLE"));
    });
    if ("port" in address) {
      server.listen({ port: address.port, host: "127.0.0.1", exclusive: true }, () => resolve({ kind: "acquired", server }));
    } else {
      server.listen({ path: address.path, exclusive: true }, () => resolve({ kind: "acquired", server }));
    }
  });
}

export async function withCredentialLock<T>(
  profileId: string,
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  // Browser consent may take two minutes, followed by a bounded token exchange.
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 240_000);
  const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
  let address: LockAddress = { port: credentialLockPort(profileId) };
  let lock: Server | undefined;
  while (lock === undefined) {
    if (signal.aborted) throw cancelled(signal);
    const attempt = await tryAcquire(address);
    if (attempt.kind === "acquired") {
      lock = attempt.server;
    } else if (attempt.kind === "denied") {
      if (process.platform !== "win32" || "path" in address) throw lockError("CREDENTIAL_LOCK_UNAVAILABLE");
      address = { path: credentialLockPipePath(profileId) };
    } else {
      try { await delay(50, undefined, { signal }); }
      catch { throw cancelled(signal); }
    }
  }
  try {
    if (signal.aborted) throw cancelled(signal);
    return await operation();
  } finally {
    await new Promise<void>((resolve, reject) => lock.close((error) => error === undefined ? resolve() : reject(lockError("CREDENTIAL_LOCK_RELEASE_FAILED"))));
  }
}
