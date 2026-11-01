import { describe, expect, it } from "vitest";
import { LoginThrottle } from "#modules/core/auth/application/login-throttle.js";

const MINUTE = 60_000;

describe("LoginThrottle", () => {
  it("allows four failures and blocks the fifth for the rest of the window", () => {
    const throttle = new LoginThrottle();
    const start = 1_000_000;
    for (let i = 0; i < 4; i++) throttle.recordFailure("alice", start + i);
    expect(throttle.retryAfter("alice", start + 10)).toBeUndefined();
    throttle.recordFailure("alice", start + 5);
    expect(throttle.retryAfter("alice", start + 10)).toBeGreaterThan(14 * 60);
    expect(throttle.retryAfter("alice", start + 15 * MINUTE + 1)).toBeUndefined();
  });

  it("is case- and whitespace-insensitive per account and independent across accounts", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i++) throttle.recordFailure(i % 2 === 0 ? " Alice " : "ALICE", 1000 + i);
    expect(throttle.retryAfter("alice", 2000)).toBeDefined();
    expect(throttle.retryAfter("bob", 2000)).toBeUndefined();
  });

  it("counts a check still running as a failure: guesses sent at once wait for it and cannot pass the limit together", async () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i++) expect(await throttle.begin("dave", 1000)).toBeUndefined();
    // Five checks running, none finished yet: the sixth waits for them…
    let sixth: number | undefined | "waiting" = "waiting";
    const waiting = throttle.begin("Dave", 1000).then((answer) => (sixth = answer));
    await Promise.resolve();
    expect(sixth).toBe("waiting");
    // …and is refused once they failed.
    for (let i = 0; i < 5; i++) throttle.end("dave", false, 1001);
    await waiting;
    expect(sixth).toBeGreaterThan(14 * 60);

    // A right password among the running checks clears the failures, and a waiting attempt goes ahead.
    const erin = new LoginThrottle();
    for (let i = 0; i < 5; i++) await erin.begin("erin", 1000);
    const next = erin.begin("erin", 1000);
    erin.end("erin", true, 1001);
    expect(await next).toBeUndefined();
    for (let i = 0; i < 4; i++) erin.end("erin", false, 1001);
    erin.end("erin", false, 1001);
    expect(erin.retryAfter("erin", 1002)).toBeGreaterThan(0);
  });

  it("a successful sign-in clears the failures", () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i++) throttle.recordFailure("carol", 1000);
    throttle.recordSuccess("carol");
    throttle.recordFailure("carol", 1000);
    expect(throttle.retryAfter("carol", 1001)).toBeUndefined();
  });
});
