// Lockout after repeated sign-in failures (ADR-0008). Per account, sliding window:
// once an account collects MAX_FAILURES failures within WINDOW_MS, sign-in is refused
// until the oldest failure leaves the window. Kept in memory — the API is a single
// process per installation (ADR-0006), and a restart only shortens a lockout.
//
// Deliberately not per client address: behind the installation's reverse proxy every
// member shares one address, so an address limit would lock the whole organization out.

import { Injectable } from "@nestjs/common";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const PRUNE_THRESHOLD = 10_000;

@Injectable()
export class LoginThrottle {
  readonly #failures = new Map<string, number[]>();

  /** Seconds until the account may try again, or undefined when sign-in is allowed. */
  retryAfter(username: string, now = Date.now()): number | undefined {
    const recent = this.#recent(username, now);
    if (recent.length < MAX_FAILURES) return undefined;
    return Math.ceil((recent[0]! + WINDOW_MS - now) / 1000);
  }

  recordFailure(username: string, now = Date.now()): void {
    if (this.#failures.size > PRUNE_THRESHOLD) this.#prune(now);
    this.#failures.set(key(username), [...this.#recent(username, now), now]);
  }

  recordSuccess(username: string): void {
    this.#failures.delete(key(username));
  }

  #recent(username: string, now: number): number[] {
    return (this.#failures.get(key(username)) ?? []).filter((at) => at > now - WINDOW_MS);
  }

  #prune(now: number): void {
    for (const [name, failures] of this.#failures) {
      if (failures.every((at) => at <= now - WINDOW_MS)) this.#failures.delete(name);
    }
  }
}

function key(username: string): string {
  return username.trim().toLowerCase();
}
