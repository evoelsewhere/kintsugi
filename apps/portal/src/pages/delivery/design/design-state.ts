// What the Design view says about a state, a set and a unit, without any component: the labels, the
// order and the filters of the Units table.

import type { DesignState, UnitDesignRow } from "@/lib/api/design";
import type { StatusTone } from "@/components/ui/status-dot";

export const STATE_LABEL: Record<DesignState, string> = {
  conformant: "Conformant",
  problems: "Problems",
  stale: "Stale",
  missing: "Missing",
  waived: "Waived",
  "not-applicable": "Not applicable",
};

export const STATE_TONE: Record<DesignState, StatusTone> = {
  conformant: "green",
  problems: "red",
  stale: "orange",
  missing: "muted",
  waived: "muted",
  "not-applicable": "muted",
};

/** What each state means, for the tooltip and the legend: the label never carries it alone. */
export const STATE_MEANING: Record<DesignState, string> = {
  conformant: "Every required file is written and passes the checks of its template.",
  problems: "Written, and the checks of its template find faults.",
  stale: "Written against an older version of the design set.",
  missing: "A required file is not written yet.",
  waived: "A person recorded that the unit does not need it.",
  "not-applicable": "The set does not apply to this kind of unit.",
};

/** The order states are listed in: the ones that need work first. */
export const STATE_ORDER: readonly DesignState[] = ["problems", "missing", "stale", "conformant", "waived"];

/** One line for a list of set ids with the version, in the order they are written. */
export function setLabel(set: { id: string; version: number }): string {
  return `${set.id}@${set.version}`;
}

export interface UnitFilters {
  /** A set id; the state filter applies to it ("" = any set). */
  set: string;
  state: DesignState | "";
  module: string;
  kind: string;
}

export const stateOf = (row: UnitDesignRow, set: string): DesignState => row.sets[set]?.state ?? "not-applicable";

/** Whether a row passes the filters; a state without a set means any set is in that state. */
export function matchesFilters(row: UnitDesignRow, filters: UnitFilters): boolean {
  if (filters.module !== "" && row.module !== filters.module) return false;
  if (filters.kind !== "" && row.kind !== filters.kind) return false;
  if (filters.state === "") return filters.set === "" || row.sets[filters.set] !== undefined;
  if (filters.set === "") return Object.values(row.sets).some((summary) => summary.state === filters.state);
  return stateOf(row, filters.set) === filters.state;
}
