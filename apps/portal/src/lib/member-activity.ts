// The words for one record of what a member's AI client did (Monitoring → Members, ADR-0069, ADR-0072). A record is a
// name, a short summary and a few scalars; this turns the scalars a plugin command reports into a line a person reads.

import type { MemberActivity } from "@/lib/api/member-plugins";

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** `1234` → `1.2k`, `2500000` → `2.5M`: token counts are read at a glance, not to the unit. */
export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** `130` → `2m 10s`. */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The line a record shows: the summary, then what the command used or what the build produced. */
export function activityLine(record: Pick<MemberActivity, "kind" | "summary" | "detail">): string {
  const detail = record.detail;
  const parts: string[] = [];
  if (record.kind === "command.run") {
    const input = num(detail["inputTokens"]);
    const output = num(detail["outputTokens"]);
    if (input !== undefined || output !== undefined) parts.push(`${compactCount(input ?? 0)} in / ${compactCount(output ?? 0)} out`);
    const turns = num(detail["turns"]);
    if (turns !== undefined) parts.push(`${turns} turn${turns === 1 ? "" : "s"}`);
    const seconds = num(detail["durationSeconds"]);
    if (seconds !== undefined) parts.push(durationText(seconds));
    if (typeof detail["model"] === "string") parts.push(detail["model"]);
  } else if (record.kind === "build.test" || record.kind === "build.mr") {
    const cases = num(detail["cases"]);
    if (cases !== undefined) parts.push(`${cases} case${cases === 1 ? "" : "s"}${num(detail["failed"]) ? `, ${num(detail["failed"])} failed` : ""}`);
    if (typeof detail["canary"] === "string") parts.push(`canary ${detail["canary"]}`);
  }
  const head = record.summary === "" ? "" : record.summary;
  return [head, ...parts].filter((part) => part !== "").join(" · ") || "—";
}
