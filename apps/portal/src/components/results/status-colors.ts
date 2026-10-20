// Chart colours of the statuses the portal shows (job runs, repository sync, document writes,
// gates), so a status has the same colour in every chart.

import { CHART_COLOR } from "./chart-colors";

export const RUN_COLOR: Record<string, string> = {
  succeeded: CHART_COLOR.green,
  failed: CHART_COLOR.red,
  running: CHART_COLOR.blue,
  queued: CHART_COLOR.blue,
  cancelled: CHART_COLOR.orange,
};

export const SYNC_COLOR: Record<string, string> = {
  ready: CHART_COLOR.green,
  cloning: CHART_COLOR.blue,
  pending: CHART_COLOR.muted,
  error: CHART_COLOR.red,
};

export const WRITE_COLOR: Record<string, string> = {
  committed: CHART_COLOR.green,
  "pr-opened": CHART_COLOR.purple,
  merged: CHART_COLOR.green,
  closed: CHART_COLOR.muted,
  queued: CHART_COLOR.blue,
  unchanged: CHART_COLOR.muted,
  failed: CHART_COLOR.red,
};

export const GATE_COLOR: Record<string, string> = {
  pending: CHART_COLOR.orange,
  approved: CHART_COLOR.green,
  waived: CHART_COLOR.blue,
  rejected: CHART_COLOR.red,
};
