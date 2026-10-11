// Stage catalog adapter: the pipeline stages are the built-in commands shipped with Kintsugi
// (packages/agents/builtin/commands, ADR-0027). They change only with a release, so they are
// read once and kept in memory. Which of them can run comes from the worker's stage plans.

import { Injectable } from "@nestjs/common";
import { loadBuiltinCommands } from "@kintsugi/agents";
import { stageInfo } from "@kintsugi/orchestrator/stages";
import type { StageDefinition, StagePlanInfo } from "../domain/job-run.js";
import { StageCatalog } from "../domain/job-run.ports.js";

@Injectable()
export class BuiltinStageCatalog extends StageCatalog {
  #stages: Promise<StageDefinition[]> | undefined;

  list(): Promise<StageDefinition[]> {
    this.#stages ??= loadBuiltinCommands().catch((error: unknown) => {
      this.#stages = undefined; // the next call retries
      throw error;
    });
    return this.#stages;
  }

  /** The worker's stage plans (services/orchestrator/src/jobs/plans): the runnable stages. */
  plans(applicationId?: string): StagePlanInfo[] {
    return stageInfo(applicationId);
  }
}
