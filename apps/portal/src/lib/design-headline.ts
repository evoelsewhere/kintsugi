// The headline of the design stage on the Delivery overview: per unit kind the project declares
// (kintsugi.yaml's `unitKinds`, ADR-0060), how many of its units have every design that applies
// to them written, then what needs a person, each named ("1 template problem").

import type { DesignAttention, DesignOverview, DesignState } from "./api/design";

/** A written design: conformant, waived, or written against an older template (stale still counts as written). */
const WRITTEN: readonly DesignState[] = ["conformant", "waived", "stale"];

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** What one kind of attention is, in a few words. */
export function attentionShort(entry: Pick<DesignAttention, "kind" | "count">): string {
  switch (entry.kind) {
    case "template-error":
      return plural(entry.count, "template problem");
    case "unresolved-component":
      return plural(entry.count, "unknown common component");
    case "uncovered-rules":
      return `${plural(entry.count, "unit")} with uncovered rules`;
    case "stale":
      return `${plural(entry.count, "unit")} with a stale design`;
  }
}

/** `<kind> <designed>/<units>` for every declared kind (then any undeclared kind a unit has), followed by the attention. */
export function designHeadline(overview: Pick<DesignOverview, "unitKinds" | "units" | "attention">): string[] {
  const kinds = [...overview.unitKinds, ...new Set(overview.units.map((unit) => unit.kind).filter((kind) => !overview.unitKinds.includes(kind)))];
  const perKind = kinds.map((kind) => {
    const units = overview.units.filter((unit) => unit.kind === kind);
    const designed = units.filter((unit) => Object.values(unit.sets).every((summary) => summary.state === "not-applicable" || WRITTEN.includes(summary.state))).length;
    return `${kind} ${designed}/${units.length}`;
  });
  return [...perKind, ...overview.attention.filter((entry) => entry.count > 0).map(attentionShort)];
}
