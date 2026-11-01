import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX, agentLimitsOff, defaultLabel, defaultValue, fieldProblems, footerStatus, formProblems, fromForm, isUnchanged, toForm, toSettings } from "./sandbox-form";

describe("the sandbox form", () => {
  it("shows minutes and megabytes and gives back seconds and bytes", () => {
    const form = toForm(DEFAULT_SANDBOX);
    expect(form).toMatchObject({ checkoutHours: "24", retentionDays: "7", scriptTimeoutMin: "10", agentTimeoutMin: "45", agentIdleTimeoutMin: "5", maxOutputMib: "50", maxTurns: "150", maxCostUsd: "10", markReadOnly: true });
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

  it("names each field's default in the units of the form, and what 0 means for a limit that can be off", () => {
    expect(defaultValue("retentionDays")).toBe(String(DEFAULT_SANDBOX.retentionDays));
    expect(defaultLabel("retentionDays", "days")).toBe(`${DEFAULT_SANDBOX.retentionDays} days`);
    expect(defaultValue("scriptTimeoutMin")).toBe(String(DEFAULT_SANDBOX.scriptTimeoutSec / 60));
    const turns = DEFAULT_SANDBOX.maxTurns;
    expect(defaultLabel("maxTurns", "turns", "no limit")).toBe(turns === 0 ? "no limit" : `${turns} turns`);
  });
});

describe("agent limits switched off", () => {
  const limited = { ...toForm(DEFAULT_SANDBOX), agentTimeoutMin: "45", maxTurns: "150", maxCostUsd: "10" };

  it("names each agent limit set to 0, and none when all are set", () => {
    expect(agentLimitsOff(limited)).toEqual([]);
    expect(agentLimitsOff({ ...limited, maxTurns: "0" })).toEqual(["maxTurns"]);
    expect(agentLimitsOff({ ...limited, agentTimeoutMin: "0", maxTurns: "0", maxCostUsd: "0.0" })).toEqual(["agentTimeoutMin", "maxTurns", "maxCostUsd"]);
  });

  it("counts a field being typed only once it reads 0, and leaves the idle limit out", () => {
    expect(agentLimitsOff({ ...limited, maxTurns: "" })).toEqual([]);
    expect(agentLimitsOff({ ...limited, maxCostUsd: "abc" })).toEqual([]);
    expect(agentLimitsOff({ ...limited, agentIdleTimeoutMin: "0" })).toEqual([]);
  });
});

describe("field problems", () => {
  const names = {
    maxTurns: { label: "Turns per job", unit: "turns" },
    agentTimeoutMin: { label: "Job timeout", unit: "min" },
    maxCostUsd: { label: "Cost per job", unit: "USD" },
    retentionDays: { label: "Keep results", unit: "days" },
  };
  const valid = { ...toForm(DEFAULT_SANDBOX), agentTimeoutMin: "45", maxTurns: "150", maxCostUsd: "10" };

  it("puts each problem on its field, in the form's own label and unit", () => {
    const { fields, other } = fieldProblems({ ...valid, maxTurns: "-5", agentTimeoutMin: "0.5", maxCostUsd: "" }, names);
    expect(fields).toEqual({
      maxTurns: "Turns per job must be 0 or between 1 and 10000 turns",
      agentTimeoutMin: "Job timeout must be 0 or between 1 and 1440 min",
      maxCostUsd: "Cost per job must be a number",
    });
    expect(other).toEqual([]);
  });

  it("keeps a problem of a field the form does not name apart", () => {
    expect(fieldProblems({ ...valid, retentionDays: "500", checkoutHours: "0" }, names)).toEqual({
      fields: { retentionDays: "Keep results must be between 1 and 90 days" },
      other: ["Checkout hours must be between 1 and 720"],
    });
  });

  it("finds nothing in a valid form", () => {
    expect(fieldProblems(valid, names)).toEqual({ fields: {}, other: [] });
  });
});

describe("the footer", () => {
  it("says the changes are unsaved before anything else", () => {
    expect(footerStatus({ changed: true, loaded: true, failed: false, isDefault: true })).toBe("Unsaved changes: save them to apply them to the next job.");
    expect(footerStatus({ changed: false, loaded: true, failed: false, isDefault: true })).toBe("Nothing saved yet: the defaults shown under each field apply.");
    expect(footerStatus({ changed: false, loaded: true, failed: false, isDefault: false, updatedBy: "admin" })).toBe("Set by admin.");
    expect(footerStatus({ changed: false, loaded: false, failed: false, isDefault: false })).toBe("Loading…");
  });
});
