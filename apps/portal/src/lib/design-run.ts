// What the Design page needs to decide before it starts a design run (ADR-0049), without any component:
// which units a set can be generated for and why the others cannot, mirroring what the API refuses
// (apps/api → design-runs.service.ts), so a person sees the reason before the request is made.

import { APPLICATION_UNIT_KEY } from "@kintsugi/domain";
import type { DesignOverview, DesignSet, UnitDesignRow, UnitSetActivity, UnitSetSummary } from "@/lib/api/design";


export type Eligibility = { ok: true } | { ok: false; reason: string };

/** What a person does with the units picked in the table: write a set for those without it, or write it again over an existing design (ADR-0081). */
export type SelectMode = "generate" | "regenerate";

/** Why a run on the unit blocks a new one, or undefined when none does. */
function busyReason(busy: UnitSetActivity | undefined): string | undefined {
  if (busy?.state === "running") return `Being generated (run ${busy.runId.slice(0, 8)})`;
  if (busy?.state === "in-pr") return "In an open pull request: merge it, or abandon it to release the unit";
  return undefined;
}

/** Why a unit (or the application) with `summary` for `set` can or cannot get it generated now. */
function judge(summary: UnitSetSummary, set: DesignOverview["sets"][number], busy: UnitSetActivity | undefined): Eligibility {
  const blocked = busyReason(busy);
  if (blocked !== undefined) return { ok: false, reason: blocked };
  if (summary.ready) return { ok: true };
  if (summary.state === "missing") return { ok: false, reason: `Needs ${set.needs.join(", ")} first` };
  return { ok: false, reason: "Already written: a design is never overwritten" };
}

/** Why `unit` can or cannot get `set` generated now. */
export function eligibility(unit: UnitDesignRow, set: DesignOverview["sets"][number], activity: readonly UnitSetActivity[]): Eligibility {
  const summary = unit.sets[set.id];
  if (summary === undefined) return { ok: false, reason: `The set does not apply to a ${unit.kind}` };
  return judge(summary, set, activity.find((entry) => entry.unit === unit.key && entry.set === set.id));
}

/** Why a design of `set` can or cannot be written again now: there must be one to replace, and no run or pull request on it. */
function judgeRegenerate(summary: UnitSetSummary, busy: UnitSetActivity | undefined): Eligibility {
  const blocked = busyReason(busy);
  if (blocked !== undefined) return { ok: false, reason: blocked };
  if (summary.files.conformant + summary.files.problems > 0) return { ok: true };
  return { ok: false, reason: "No design of this set to regenerate: generate it first" };
}

/** Why `unit` can or cannot get the design of `set` written again now (ADR-0081). */
export function regenerability(unit: UnitDesignRow, set: DesignOverview["sets"][number], activity: readonly UnitSetActivity[]): Eligibility {
  const summary = unit.sets[set.id];
  if (summary === undefined) return { ok: false, reason: `The set does not apply to a ${unit.kind}` };
  return judgeRegenerate(summary, activity.find((entry) => entry.unit === unit.key && entry.set === set.id));
}

/** Why the application's own design of a set can or cannot be written again now (ADR-0081). */
export function applicationRegenerability(overview: Pick<DesignOverview, "application">, set: DesignOverview["sets"][number], activity: readonly UnitSetActivity[]): Eligibility {
  if (set.scope !== "application") return { ok: false, reason: "This set is generated for each unit, not for the application" };
  const summary = overview.application.sets[set.id];
  if (summary === undefined) return { ok: false, reason: "The set has no document to write for the application" };
  return judgeRegenerate(summary, activity.find((entry) => entry.unit === APPLICATION_UNIT_KEY && entry.set === set.id));
}

/** Why the application can or cannot get a set of scope `application` generated now (ADR-0050). */
export function applicationEligibility(overview: Pick<DesignOverview, "application">, set: DesignOverview["sets"][number], activity: readonly UnitSetActivity[]): Eligibility {
  if (set.scope !== "application") return { ok: false, reason: "This set is generated for each unit, not for the application" };
  const summary = overview.application.sets[set.id];
  if (summary === undefined) return { ok: false, reason: "The set has no document to write for the application" };
  return judge(summary, set, activity.find((entry) => entry.unit === APPLICATION_UNIT_KEY && entry.set === set.id));
}

/** What a person reads about a set before generating it: who it is for, what it writes, what it needs and reads. */
export function setFacts(set: DesignSet): Array<{ label: string; value: string }> {
  const required = set.files.filter((file) => file.required).length;
  return [
    { label: "For", value: set.scope === "application" ? "the application as a whole" : set.appliesTo.length === 0 ? "every unit" : `units of kind ${set.appliesTo.join(", ")}` },
    { label: "Documents", value: `${set.files.length} (${required} required): ${set.files.map((file) => file.path).join(", ")}` },
    ...(set.profiles.length === 0 ? [] : [{ label: "Profiles", value: set.profiles.map((profile) => `${profile.kind} (v${profile.version})`).join(", ") }]),
    ...(set.needs.length === 0 ? [] : [{ label: "After", value: set.needs.join(", ") }]),
    ...(set.reads.length === 0 ? [] : [{ label: "Also reads", value: set.reads.join(", ") }]),
  ];
}

/** The units of `rows` the set can be generated for (or, in `regenerate` mode, written again for), in table order. */
export function selectable(rows: readonly UnitDesignRow[], set: DesignOverview["sets"][number] | undefined, activity: readonly UnitSetActivity[], mode: SelectMode = "generate"): string[] {
  if (set === undefined) return [];
  const judge = mode === "regenerate" ? regenerability : eligibility;
  return rows.filter((row) => judge(row, set, activity).ok).map((row) => row.key);
}

/** The picked units that can still be generated (a refresh may have blocked some), sorted. */
export function stillSelectable(picked: Iterable<string>, rows: readonly UnitDesignRow[], set: DesignOverview["sets"][number] | undefined, activity: readonly UnitSetActivity[], mode: SelectMode = "generate"): string[] {
  const allowed = new Set(selectable(rows, set, activity, mode));
  return [...picked].filter((key) => allowed.has(key)).sort();
}

/** The units whose design of `set` was written against an older version of its template: what a regeneration brings up to date. */
export function staleUnits(rows: readonly UnitDesignRow[], set: DesignOverview["sets"][number] | undefined): string[] {
  if (set === undefined) return [];
  return rows.filter((row) => (row.sets[set.id]?.files.stale ?? 0) > 0).map((row) => row.key);
}

/** Why the Generate button is off; undefined when it can be pressed. */
export function generateBlocker(options: { set: string; count: number; /** Why no run can start at all (permission, repositories). */ disabled: string | undefined; regenerate?: boolean }): string | undefined {
  if (options.disabled !== undefined) return options.disabled;
  if (options.set === "") return `Choose a design set to ${options.regenerate === true ? "regenerate" : "generate"}.`;
  if (options.count === 0) return `Select the units to ${options.regenerate === true ? "regenerate it for" : "generate it for"}.`;
  return undefined;
}

/** `payroll/run-period` units as one line for a confirmation: the first few, then a count. */
export function unitsLine(keys: readonly string[], shown = 12): string {
  return keys.length <= shown ? keys.join(", ") : `${keys.slice(0, shown).join(", ")} +${keys.length - shown}`;
}
