import { describe, expect, it } from "vitest";
import type { DesignSet, UnitDesignRow, UnitSetActivity, UnitSetSummary } from "./api/design";
import { applicationEligibility, eligibility, generateBlocker, selectable, setFacts, stillSelectable, unitsLine } from "./design-run";

const summary = (set: string, over: Partial<UnitSetSummary> = {}): UnitSetSummary => ({ set, version: 1, state: "missing", files: { total: 2, conformant: 0, problems: 0, missing: 2, stale: 0, waived: 0 }, ready: true, ...over });
const unit = (key: string, sets: Record<string, UnitSetSummary>, kind = "screen"): UnitDesignRow => ({ key, module: key.split("/")[0]!, unit: key.split("/")[1]!, kind, sets, rules: { total: 0, uncovered: null } });

const BASIC = { id: "basic", title: "Basic design", version: 1, needs: [] as string[], scope: "unit" as const };
const DETAIL = { id: "detail", title: "Detail design", version: 1, needs: ["basic"], scope: "unit" as const };
const ARCH = { id: "arch", title: "Architecture", version: 1, needs: [] as string[], scope: "application" as const };

describe("eligibility", () => {
  it("accepts a unit that is ready for the set", () => {
    expect(eligibility(unit("a/x", { basic: summary("basic") }), BASIC, [])).toEqual({ ok: true });
  });

  it("says why a unit cannot get the set", () => {
    const reasonOf = (row: UnitDesignRow, set = BASIC, activity: UnitSetActivity[] = []): string | undefined => {
      const result = eligibility(row, set, activity);
      return result.ok ? undefined : result.reason;
    };
    expect(reasonOf(unit("a/x", {}, "api"))).toBe("The set does not apply to a api");
    expect(reasonOf(unit("a/x", { basic: summary("basic", { state: "conformant", ready: false }) }))).toBe("Already written: a design is never overwritten");
    expect(reasonOf(unit("a/x", { basic: summary("basic", { state: "problems", ready: false }) }))).toBe("Already written: a design is never overwritten");
    expect(reasonOf(unit("a/x", { detail: summary("detail", { ready: false }) }), DETAIL)).toBe("Needs basic first");
    expect(reasonOf(unit("a/x", { basic: summary("basic") }), BASIC, [{ unit: "a/x", set: "basic", state: "running", runId: "abcdef0123456789" }])).toBe("Being generated (run abcdef01)");
    expect(reasonOf(unit("a/x", { basic: summary("basic") }), BASIC, [{ unit: "a/x", set: "basic", state: "in-pr", runId: "r1" }])).toBe("In an open pull request: merge it, or abandon it to release the unit");
  });

  it("is not blocked by what a run does for another set or another unit", () => {
    const activity: UnitSetActivity[] = [{ unit: "a/x", set: "detail", state: "running", runId: "r1" }, { unit: "b/y", set: "basic", state: "running", runId: "r2" }];
    expect(eligibility(unit("a/x", { basic: summary("basic") }), BASIC, activity)).toEqual({ ok: true });
  });
});

describe("selection", () => {
  const rows = [unit("a/one", { basic: summary("basic") }), unit("a/two", { basic: summary("basic", { state: "conformant", ready: false }) }), unit("b/three", { basic: summary("basic") })];

  it("lists the units a set can be generated for, in table order", () => {
    expect(selectable(rows, BASIC, [])).toEqual(["a/one", "b/three"]);
    expect(selectable(rows, undefined, [])).toEqual([]);
    expect(selectable(rows, BASIC, [{ unit: "a/one", set: "basic", state: "running", runId: "r" }])).toEqual(["b/three"]);
  });

  it("drops picked units a refresh blocked or removed", () => {
    expect(stillSelectable(new Set(["b/three", "a/two", "gone/x", "a/one"]), rows, BASIC, [])).toEqual(["a/one", "b/three"]);
  });
});

describe("generateBlocker", () => {
  const ok = { set: "basic", count: 2, disabled: undefined };
  it("is undefined when a run can start", () => {
    expect(generateBlocker(ok)).toBeUndefined();
  });
  it("names the first thing in the way", () => {
    expect(generateBlocker({ ...ok, disabled: "Starting a run needs the jobs.run permission." })).toContain("jobs.run");
    expect(generateBlocker({ ...ok, disabled: "Link a legacy code repo to the application to run stages.", set: "" })).toBe("Link a legacy code repo to the application to run stages.");
    expect(generateBlocker({ ...ok, set: "" })).toBe("Choose a design set to generate.");
    expect(generateBlocker({ ...ok, count: 0 })).toBe("Select the units to generate it for.");
  });
});

describe("unitsLine", () => {
  it("shows the first units and counts the rest", () => {
    expect(unitsLine(["a/x", "b/y"])).toBe("a/x, b/y");
    expect(unitsLine(Array.from({ length: 15 }, (_, index) => `m/u${index}`))).toBe(`${Array.from({ length: 12 }, (_, index) => `m/u${index}`).join(", ")} +3`);
  });
});

describe("the application's own design (ADR-0050)", () => {
  const overview = (over: Partial<UnitSetSummary> = {}) => ({ application: { sets: { arch: summary("arch", over) } } });
  const reasonOf = (value: ReturnType<typeof applicationEligibility>): string | undefined => (value.ok ? undefined : value.reason);

  it("can be generated when the set is ready for it, and says why not otherwise", () => {
    expect(applicationEligibility(overview(), ARCH, [])).toEqual({ ok: true });
    expect(reasonOf(applicationEligibility(overview({ state: "conformant", ready: false }), ARCH, []))).toBe("Already written: a design is never overwritten");
    expect(reasonOf(applicationEligibility(overview({ ready: false }), { ...ARCH, needs: ["other"] }, []))).toBe("Needs other first");
    expect(reasonOf(applicationEligibility(overview(), ARCH, [{ unit: "@app", set: "arch", state: "running", runId: "abcdef0123" }]))).toBe("Being generated (run abcdef01)");
    expect(reasonOf(applicationEligibility(overview(), ARCH, [{ unit: "@app", set: "arch", state: "in-pr", runId: "r1" }]))).toContain("open pull request");
    expect(reasonOf(applicationEligibility(overview(), BASIC, []))).toBe("This set is generated for each unit, not for the application");
    expect(reasonOf(applicationEligibility({ application: { sets: {} } }, ARCH, []))).toBe("The set has no document to write for the application");
  });

  it("is not blocked by a run on a unit or on another set", () => {
    const activity: UnitSetActivity[] = [{ unit: "a/x", set: "arch", state: "running", runId: "r1" }, { unit: "@app", set: "other", state: "running", runId: "r2" }];
    expect(applicationEligibility(overview(), ARCH, activity)).toEqual({ ok: true });
  });

  it("is never offered as a unit of a table", () => {
    expect(reasonOf(eligibility(unit("a/x", { basic: summary("basic") }), ARCH, []))).toBe("The set does not apply to a screen");
  });
});

describe("setFacts", () => {
  const set = (over: Partial<DesignSet>): DesignSet => ({ id: "s", title: "S", version: 1, scope: "unit", appliesTo: [], needs: [], description: "", reads: [], instructions: "", producedBy: [], files: [{ path: "a.md", template: "a.md", required: true, ref: "s@1", sections: [] }, { path: "b.md", template: "b.md", required: false, ref: "s@1", sections: [] }], profiles: [], ...over });

  it("says who a set is for, what it writes, what it needs and what it also reads", () => {
    expect(setFacts(set({}))).toEqual([{ label: "For", value: "every unit" }, { label: "Documents", value: "2 (1 required): a.md, b.md" }]);
    expect(setFacts(set({ appliesTo: ["screen", "api"], needs: ["basic"] })).map((fact) => [fact.label, fact.value])).toEqual([
      ["For", "units of kind screen, api"],
      ["Documents", "2 (1 required): a.md, b.md"],
      ["After", "basic"],
    ]);
    expect(setFacts(set({ profiles: [{ kind: "screen", version: 3, removes: [], instructions: "", files: [], examples: [] }, { kind: "batch", version: 1, removes: ["a.md"], instructions: "", files: [], examples: [] }] })).map((fact) => [fact.label, fact.value])).toEqual([
      ["For", "every unit"],
      ["Documents", "2 (1 required): a.md, b.md"],
      ["Profiles", "screen (v3), batch (v1)"],
    ]);
    expect(setFacts(set({ scope: "application", reads: ["10-applications/{app}/00-inputs/", "02-architecture/"] })).map((fact) => [fact.label, fact.value])).toEqual([
      ["For", "the application as a whole"],
      ["Documents", "2 (1 required): a.md, b.md"],
      ["Also reads", "10-applications/{app}/00-inputs/, 02-architecture/"],
    ]);
  });
});
