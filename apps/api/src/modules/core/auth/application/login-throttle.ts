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
  /** Password checks started and not finished yet, per account: each counts as a failure until it ends. */
  readonly #pending = new Map<string, number>();
  /** Attempts waiting for running checks of the same account to end. */
  readonly #waiting = new Map<string, Array<() => void>>();

  /** Seconds until the account may try again, or undefined when sign-in is allowed. */
  retryAfter(username: string, now = Date.now()): number | undefined {
    const recent = this.#recent(username, now);
    if (recent.length < MAX_FAILURES) return undefined;
    return Math.ceil((recent[0]! + WINDOW_MS - now) / 1000);
  }

  /**
   * Reserves one attempt before the password is checked, or says in how many seconds to try again. A check still
   * running counts as a failure until `end`, so guesses sent at once cannot pass the limit together: while the running
   * checks fill it, an attempt waits for them (a right password among them lets it go ahead) instead of being refused.
   */
  async begin(username: string, now = Date.now()): Promise<number | undefined> {
    for (;;) {
      const retryAfter = this.retryAfter(username, now);
      if (retryAfter !== undefined) return retryAfter;
      const pending = this.#pending.get(key(username)) ?? 0;
      if (this.#recent(username, now).length + pending < MAX_FAILURES) {
        this.#pending.set(key(username), pending + 1);
        return undefined;
      }
      await new Promise<void>((resolve) => this.#waiting.set(key(username), [...(this.#waiting.get(key(username)) ?? []), resolve]));
    }
  }

  /**
   * Ends an attempt `begin` reserved: a failure is recorded, a success clears the account's failures, and a check that
   * did not finish (`undefined`: the database failed) records nothing.
   */
  end(username: string, succeeded: boolean | undefined, now = Date.now()): void {
    const pending = (this.#pending.get(key(username)) ?? 1) - 1;
    if (pending > 0) this.#pending.set(key(username), pending);
    else this.#pending.delete(key(username));
    if (succeeded === true) this.recordSuccess(username);
    else if (succeeded === false) this.recordFailure(username, now);
    // The waiting attempts look again.
    const waiting = this.#waiting.get(key(username)) ?? [];
    this.#waiting.delete(key(username));
    for (const wake of waiting) wake();
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
