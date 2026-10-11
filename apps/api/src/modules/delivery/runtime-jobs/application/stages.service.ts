// Application layer: the pipeline stages (ADR-0027) as the portal shows them: every built-in
// command with who runs it, and whether it can be run from the portal yet.

import { Injectable } from "@nestjs/common";
import { RUNNABLE_STAGES, type StageView } from "../domain/job-run.js";
import { StageCatalog } from "../domain/job-run.ports.js";

@Injectable()
export class StagesService {
  constructor(private readonly catalog: StageCatalog) {}

  async list(): Promise<StageView[]> {
    const runnable: readonly string[] = RUNNABLE_STAGES;
    return (await this.catalog.list()).map((stage) => ({ ...stage, runnable: runnable.includes(stage.id) }));
  }
}
