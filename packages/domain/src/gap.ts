/** A resolution remains with the original question. A status alone never settles missing evidence. */
export const GAP_STATUSES = ["open", "resolved"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export function isMeaningfulGapText(value: string | undefined): boolean {
  return value !== undefined && !/^(?:\s*|[-—]|todo\b.*|tbd\b.*|none\.?)$/i.test(value.trim());
}

export function gapIsResolved(gap: { status?: string; answer?: string; evidence?: string }): boolean {
  return gap.status === "resolved" && isMeaningfulGapText(gap.answer) && isMeaningfulGapText(gap.evidence);
}

/**
 * Who or what can settle a gap (ADR-0087): the owner of a missing source or configuration, an expert of the business,
 * production data (records, logs, a run), or a check that was not run here. The `Settled by` column of a gaps table.
 */
export const GAP_SETTLERS = ["source-owner", "expert", "data", "check"] as const;
export type GapSettler = (typeof GAP_SETTLERS)[number];

/** The settler a gap of a kind has when its row names none (older tables, or a value outside the list). */
export const DEFAULT_GAP_SETTLER: Readonly<Record<"missing-source" | "unresolved" | "ambiguous" | "unverified", GapSettler>> = {
  "missing-source": "source-owner",
  unresolved: "data",
  ambiguous: "expert",
  unverified: "check",
};

export function isGapSettler(value: string): value is GapSettler {
  return (GAP_SETTLERS as readonly string[]).includes(value);
}
