/** A resolution remains with the original question. A status alone never settles missing evidence. */
export const GAP_STATUSES = ["open", "resolved"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export function isMeaningfulGapText(value: string | undefined): boolean {
  return value !== undefined && !/^(?:\s*|[-—]|todo\b.*|tbd\b.*|none\.?)$/i.test(value.trim());
}

export function gapIsResolved(gap: { status?: string; answer?: string; evidence?: string }): boolean {
  return gap.status === "resolved" && isMeaningfulGapText(gap.answer) && isMeaningfulGapText(gap.evidence);
}
