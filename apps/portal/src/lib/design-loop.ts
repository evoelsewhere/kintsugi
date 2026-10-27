// The verify loop of a design run (ADR-0083), as the worker keeps it in the run's summary (`outputSummary.report`): how many
// rounds ran, why the loop stopped, and the status of each finding. Read defensively: the summary is JSON of a stage, not a contract
// the portal can assume for an older run.

import type { StatusTone } from "@/components/ui/status-dot";

export type LoopStop = "clean" | "stalled" | "limit" | "none";
export type FindingStatus = "open" | "fixed";
export type FindingSeverity = "blocker" | "major" | "minor";

export interface LoopFinding {
  id: string;
  severity: FindingSeverity;
  category: string;
  /** `review` (a unit's reviewer) or `contract` (the reviewer of units that share interfaces). */
  source: string;
  document: string;
  section: string;
  finding: string;
  suggestion: string;
  status: FindingStatus;
  firstRound: number;
  lastRound: number;
}

export interface LoopUnit {
  unit: string;
  kind: string;
  state: string;
  reviewed: boolean;
  findings: LoopFinding[];
}

export interface LoopRound {
  round: number;
  open: number;
  /** Units a designer fixed after the round's review. */
  fixed: number;
  /** Findings that were open before and are gone. */
  resolved: number;
}

export interface DesignLoop {
  set: string;
  round: number;
  stop: LoopStop;
  open: number;
  resolvedTotal: number;
  rounds: LoopRound[];
  clusters: Array<{ id: string; units: string[]; reviewed: boolean }>;
  coverage: { total: number; covered: number; uncovered: string[] } | undefined;
  units: LoopUnit[];
}

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function findingOf(value: unknown): LoopFinding | undefined {
  const entry = record(value);
  if (entry === undefined) return undefined;
  const severity = entry["severity"] === "blocker" || entry["severity"] === "major" || entry["severity"] === "minor" ? entry["severity"] : undefined;
  if (severity === undefined) return undefined;
  return {
    id: text(entry["id"]),
    severity,
    category: text(entry["category"]),
    source: text(entry["source"]) || "review",
    document: text(entry["document"]),
    section: text(entry["section"]),
    finding: text(entry["finding"]),
    suggestion: text(entry["suggestion"]),
    status: entry["status"] === "fixed" ? "fixed" : "open",
    firstRound: count(entry["firstRound"]),
    lastRound: count(entry["lastRound"]),
  };
}

/** The loop of a design run from its summary; undefined for a run that kept none (an older run, or one that is still running). */
export function designLoopOf(summary: Record<string, unknown> | undefined): DesignLoop | undefined {
  const report = record(summary?.["report"]);
  if (report === undefined || count(report["version"]) !== 1) return undefined;
  const stop = report["stop"];
  const coverage = record(report["coverage"]);
  return {
    set: text(report["set"]),
    round: count(report["round"]),
    stop: stop === "clean" || stop === "stalled" || stop === "limit" ? stop : "none",
    open: count(report["open"]),
    resolvedTotal: count(report["resolvedTotal"]),
    rounds: list(report["rounds"]).flatMap((entry): LoopRound[] => {
      const round = record(entry);
      return round === undefined ? [] : [{ round: count(round["round"]), open: count(round["open"]), fixed: count(round["fixed"]), resolved: count(round["resolved"]) }];
    }),
    clusters: list(report["clusters"]).flatMap((entry) => {
      const cluster = record(entry);
      return cluster === undefined || text(cluster["id"]) === "" ? [] : [{ id: text(cluster["id"]), units: list(cluster["units"]).map(text).filter((unit) => unit !== ""), reviewed: cluster["reviewed"] === true }];
    }),
    coverage: coverage === undefined ? undefined : { total: count(coverage["total"]), covered: count(coverage["covered"]), uncovered: list(coverage["uncovered"]).map(text).filter((id) => id !== "") },
    units: list(report["units"]).flatMap((entry): LoopUnit[] => {
      const unit = record(entry);
      if (unit === undefined || text(unit["unit"]) === "") return [];
      return [{ unit: text(unit["unit"]), kind: text(unit["kind"]), state: text(unit["state"]), reviewed: unit["reviewed"] === true, findings: list(unit["findings"]).flatMap((found) => findingOf(found) ?? []) }];
    }),
  };
}

export const STOP_LABEL: Record<LoopStop, string> = {
  clean: "Clean",
  stalled: "Stalled",
  limit: "Stopped at a limit",
  none: "Not reviewed",
};

export const STOP_TONE: Record<LoopStop, StatusTone> = { clean: "green", stalled: "orange", limit: "orange", none: "muted" };

/** What the stop means for the person who reviews the pull request. */
export function stopExplanation(loop: DesignLoop): string {
  switch (loop.stop) {
    case "clean":
      return `Round ${loop.round} found no blocker, no major and no failing check: the design was verified after its fixes.`;
    case "stalled":
      return `The loop stopped after round ${loop.round}: the ${loop.open} open item(s) did not improve over two rounds, or came back unchanged. A person has to decide them.`;
    case "limit":
      return `The loop stopped after round ${loop.round} with ${loop.open} open item(s): the stage ran out of agent jobs or was interrupted, so the last fix was not reviewed again.`;
    case "none":
      return "No review round ran for this run.";
  }
}

export const STATE_LABEL: Record<string, string> = { ready: "Ready", "ready-with-findings": "Ready with findings", incomplete: "Incomplete", draft: "Draft" };
export const STATE_TONE: Record<string, StatusTone> = { ready: "green", "ready-with-findings": "orange", incomplete: "red", draft: "muted" };

export const SEVERITY_TONE: Record<FindingSeverity, StatusTone> = { blocker: "red", major: "orange", minor: "muted" };

/** The rounds a finding stayed in, as people read it: "round 2", or "rounds 1–3". */
export function roundsOf(finding: Pick<LoopFinding, "firstRound" | "lastRound">): string {
  if (finding.firstRound === 0) return "";
  return finding.firstRound === finding.lastRound ? `round ${finding.firstRound}` : `rounds ${finding.firstRound}–${finding.lastRound}`;
}

/** A unit's findings by status: the open ones, then the fixed ones. */
export function findingCounts(unit: LoopUnit): { open: number; fixed: number } {
  return { open: unit.findings.filter((finding) => finding.status === "open").length, fixed: unit.findings.filter((finding) => finding.status === "fixed").length };
}
