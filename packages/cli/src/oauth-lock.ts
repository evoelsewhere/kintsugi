import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { userInfo } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { CREDENTIAL_SERVICE } from "./credential-store.js";
import { CliError } from "./profile.js";

/**
 * Cross-process keyring mutex, v1. The key is the OS identity + keyring service/account,
 * never a credential or installation URL. Use the IANA dynamic/private unprivileged
 * range 49152–65535. Hash collisions merely serialize unrelated accounts.
 *
 * An exclusive loopback listener is an OS-owned lease: process death releases it,
 * including an ungraceful crash. No secret, PID, lease file or stale-lock deletion is
 * involved. Never steal a busy port: unrelated listeners fail closed at the deadline.
 * Keep this key/range stable across CLI versions that share the same keyring service.
 */
export function credentialLockPort(profileId: string): number {
  const identity = userInfo();
  const key = ["v1", identity.username, identity.homedir, CREDENTIAL_SERVICE, profileId].join("\0");
  return 49152 + createHash("sha256").update(key).digest().readUInt32BE(0) % 16384;
}

function lockError(code: "CREDENTIAL_LOCK_UNAVAILABLE" | "CREDENTIAL_LOCK_TIMEOUT" | "CREDENTIAL_LOCK_RELEASE_FAILED"): CliError {
  return new CliError(code, "Could not exclusively access the Kintsugi credential store. Close other Kintsugi CLI connections and retry; a local port may be unavailable. No refresh was attempted without the lock.");
}

function cancelled(signal: AbortSignal): CliError {
  return signal.reason instanceof Error && signal.reason.name === "TimeoutError"
    ? lockError("CREDENTIAL_LOCK_TIMEOUT")
    : new CliError("CANCELLED", "Credential operation cancelled");
}

async function tryAcquire(port: number): Promise<Server | undefined> {
  const server = createServer((socket) => socket.destroy());
  return await new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(undefined);
      else reject(lockError("CREDENTIAL_LOCK_UNAVAILABLE"));
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(server));
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
  const port = credentialLockPort(profileId);
  let lock: Server | undefined;
  while (lock === undefined) {
    if (signal.aborted) throw cancelled(signal);
    lock = await tryAcquire(port);
    if (lock === undefined) {
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
