// Figures over lists of job runs, for the dashboards: durations, the success rate of the
// finished runs and the average run time per name.

import type { JobRunView } from "@/lib/api/job-runs";

/** Run time of a finished run in milliseconds; undefined while it has not started or finished. */
export const durationMs = (run: Pick<JobRunView, "startedAt" | "finishedAt">): number | undefined =>
  run.startedAt === undefined || run.finishedAt === undefined ? undefined : Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());

/** Succeeded / (succeeded + failed), or undefined before any run finished that way. */
export function successRate(runs: readonly Pick<JobRunView, "status">[]): number | undefined {
  const finished = runs.filter((run) => run.status === "succeeded" || run.status === "failed");
  return finished.length === 0 ? undefined : finished.filter((run) => run.status === "succeeded").length / finished.length;
}

/** The mean run time of the succeeded runs, or undefined when none finished. */
export function averageMs(runs: readonly JobRunView[]): number | undefined {
  const times = runs.filter((run) => run.status === "succeeded").flatMap((run) => durationMs(run) ?? []);
  return times.length === 0 ? undefined : times.reduce((sum, ms) => sum + ms, 0) / times.length;
}

/** "4m 12s" for a span in milliseconds. */
export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const percent = (rate: number | undefined): string => (rate === undefined ? "—" : `${Math.round(rate * 100)}%`);
