import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX, formProblems, fromForm, isUnchanged, toForm, toSettings } from "./sandbox-form";

describe("the sandbox form", () => {
  it("shows minutes and megabytes and gives back seconds and bytes", () => {
    const form = toForm(DEFAULT_SANDBOX);
    expect(form).toMatchObject({ checkoutHours: "24", retentionDays: "7", scriptTimeoutMin: "10", agentTimeoutMin: "0", agentIdleTimeoutMin: "5", maxOutputMib: "50", maxTurns: "0", maxCostUsd: "0", markReadOnly: true });
    expect(toSettings(form)).toEqual(DEFAULT_SANDBOX);
    expect(isUnchanged(form, DEFAULT_SANDBOX)).toBe(true);
    expect(isUnchanged({ ...form, retentionDays: "8" }, DEFAULT_SANDBOX)).toBe(false);
  });

  it("keeps fractions of a minute, a fractional cost and a half-typed number out of the settings until it is a number", () => {
    const form = { ...toForm(DEFAULT_SANDBOX), agentIdleTimeoutMin: "0.5", maxCostUsd: "2.5" };
    expect(toSettings(form)).toMatchObject({ agentIdleTimeoutSec: 30, maxCostUsd: 2.5 });
    expect(toForm({ ...DEFAULT_SANDBOX, agentIdleTimeoutSec: 90 }).agentIdleTimeoutMin).toBe("1.5");
    const typing = { ...form, retentionDays: "" };
    expect(fromForm(typing).retentionDays).toBeNaN();
    expect(formProblems(typing)).toEqual(["Retention days must be a number"]);
    expect(toSettings(typing)).toBeUndefined();
  });

  it("names the fields that are out of range, in the words of the API", () => {
    const form = { ...toForm(DEFAULT_SANDBOX), checkoutHours: "0", scriptTimeoutMin: "0.01", maxOutputMib: "0.5", maxTurns: "-3" };
    expect(formProblems(form)).toEqual([
      "Checkout hours must be between 1 and 720",
      "Script timeout must be between 10 and 86400",
      "Output limit must be between 1048576 and 10737418240",
      "Turn limit must be 0 or between 1 and 10000",
    ]);
  });
});
