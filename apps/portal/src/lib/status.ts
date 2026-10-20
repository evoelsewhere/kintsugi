// Status vocabulary of the portal: one tone and one label per status of a job run, a
// document write, a repository mirror, a gate and a worker. Every page renders statuses through these maps
// (components/status-badges.tsx), so a status looks the same wherever it appears.

import type { StatusTone } from "@/components/ui/status-dot";

export interface StatusStyle {
  tone: StatusTone;
  label: string;
}

export const RUN_STATUS: Record<string, StatusStyle> = {
  queued: { tone: "muted", label: "Queued" },
  running: { tone: "blue", label: "Running" },
  succeeded: { tone: "green", label: "Succeeded" },
  failed: { tone: "red", label: "Failed" },
  cancelled: { tone: "orange", label: "Cancelled" },
};

/** The derived status of a catalog item (ADR-0033). */
export const ITEM_STATUS: Record<string, StatusStyle> = {
  running: { tone: "blue", label: "Running" },
  "in-pr": { tone: "purple-light", label: "In pull request" },
  failed: { tone: "red", label: "Failed" },
  stale: { tone: "orange", label: "Stale" },
  understood: { tone: "green", label: "Understood" },
  "not-analysed": { tone: "muted", label: "Not analysed" },
  retired: { tone: "muted", label: "Retired" },
};

export const WRITE_STATUS: Record<string, StatusStyle> = {
  queued: { tone: "blue", label: "Queued" },
  committed: { tone: "green", label: "Committed" },
  "pr-opened": { tone: "purple-light", label: "Pull request opened" },
  merged: { tone: "green", label: "Merged" },
  closed: { tone: "muted", label: "Closed" },
  unchanged: { tone: "muted", label: "No changes" },
  failed: { tone: "red", label: "Failed" },
};

export const SYNC_STATUS: Record<string, StatusStyle> = {
  pending: { tone: "muted", label: "Waiting for first clone" },
  cloning: { tone: "blue", label: "Cloning" },
  ready: { tone: "green", label: "Ready" },
  error: { tone: "red", label: "Sync failed" },
};

export const GATE_STATUS: Record<string, StatusStyle> = {
  pending: { tone: "orange", label: "Pending" },
  approved: { tone: "green", label: "Approved" },
  rejected: { tone: "red", label: "Rejected" },
  waived: { tone: "purple-light", label: "Waived" },
};

export const WORKER_STATE: Record<string, StatusStyle> = {
  up: { tone: "green", label: "Up" },
  stale: { tone: "red", label: "Not seen" },
  stopped: { tone: "muted", label: "Stopped" },
};

const UNKNOWN: StatusStyle = { tone: "muted", label: "Unknown" };

/** The style of `status` in `map`, or a neutral one named after the raw status. */
export function styleOf(map: Record<string, StatusStyle>, status: string | undefined): StatusStyle {
  if (status === undefined) return UNKNOWN;
  return map[status] ?? { tone: "muted", label: status };
}

/** Run statuses a run leaves (queued, running) — follow these until they settle. */
export const isActiveStatus = (status: string): boolean => status === "queued" || status === "running";
