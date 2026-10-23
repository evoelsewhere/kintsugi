import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX, SANDBOX_FIELDS, resolveSandbox, sandboxProblems } from "../src/sandbox.js";

describe("sandbox settings (ADR-0055)", () => {
  it("accepts the defaults, and every field has a rule", () => {
    expect(sandboxProblems(DEFAULT_SANDBOX)).toEqual([]);
    expect([...SANDBOX_FIELDS].sort()).toEqual(Object.keys(DEFAULT_SANDBOX).filter((field) => field !== "markReadOnly").sort());
  });

  it("names every field that is out of range, a fraction where a whole number is due, or not a number", () => {
    const problems = sandboxProblems({ ...DEFAULT_SANDBOX, checkoutHours: 0, retentionDays: 365, scriptTimeoutSec: 5.5, agentTimeoutSec: 30, agentIdleTimeoutSec: 10, maxOutputBytes: 10, maxTurns: -1, maxCostUsd: "a lot", markReadOnly: "yes" });
    expect(problems).toEqual([
      "Checkout hours must be between 1 and 720",
      "Retention days must be between 1 and 90",
      "Script timeout must be a whole number",
      "Agent timeout must be 0 or between 60 and 86400",
      "Agent idle timeout must be 0 or between 30 and 3600",
      "Output limit must be between 1048576 and 10737418240",
      "Turn limit must be 0 or between 1 and 10000",
      "Cost limit must be a number",
      "Read-only marking must be on or off",
    ]);
    expect(sandboxProblems({})).toHaveLength(SANDBOX_FIELDS.length + 1);
  });

  it("allows 0 where it means no limit or off, and a fractional cost", () => {
    expect(sandboxProblems({ ...DEFAULT_SANDBOX, agentTimeoutSec: 0, agentIdleTimeoutSec: 0, maxTurns: 0, maxCostUsd: 0.5 })).toEqual([]);
    expect(sandboxProblems({ ...DEFAULT_SANDBOX, checkoutHours: 0 })).not.toEqual([]);
  });

  it("resolves a stored value field by field: valid fields are taken, the others are the defaults", () => {
    expect(resolveSandbox(undefined)).toEqual(DEFAULT_SANDBOX);
    expect(resolveSandbox("garbage")).toEqual(DEFAULT_SANDBOX);
    expect(resolveSandbox({ retentionDays: 14, checkoutHours: -3, markReadOnly: false, scriptTimeoutSec: "slow", maxTurns: 40 })).toEqual({
      ...DEFAULT_SANDBOX,
      retentionDays: 14,
      markReadOnly: false,
      maxTurns: 40,
    });
  });
});
