// What the latest run of every (application, runtime stage) slot of a project says.

import type { JobRunView, StageView } from "@/lib/api/job-runs";
import type { ApplicationView } from "@/lib/api/projects";
import { latestRun } from "@/lib/stages";

export interface PipelineHealth {
  /** Stage slots across the applications whose latest run succeeded, and how many slots there are. */
  done: number;
  total: number;
  /** Slots whose latest run failed or was cancelled. */
  attention: Array<{ application: ApplicationView; stage: StageView; run: JobRunView }>;
}

/** What the latest run of every (application, runtime stage) slot says. */
export function pipelineHealth(applications: readonly ApplicationView[], stages: readonly StageView[], runs: readonly JobRunView[]): PipelineHealth {
  const health: PipelineHealth = { done: 0, total: 0, attention: [] };
  for (const application of applications) {
    const own = runs.filter((run) => run.applicationId === application.id);
    for (const stage of stages) {
      health.total += 1;
      const last = latestRun(own, stage.id);
      if (last?.status === "succeeded") health.done += 1;
      else if (last?.status === "failed" || last?.status === "cancelled") health.attention.push({ application, stage, run: last });
    }
  }
  return health;
}
