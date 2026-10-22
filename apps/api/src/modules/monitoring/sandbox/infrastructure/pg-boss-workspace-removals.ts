// Queue adapter: asks the worker to remove one job workspace through pg-boss (queue `workspace-cleanup`, ADR-0058).

import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ensureWorkspaceCleanupQueue, sendWorkspaceCleanup } from "@kintsugi/orchestrator/queues";
import { closeJobQueue, getJobQueue } from "#common/queue/job-queue.js";
import { WorkspaceRemovals } from "../domain/sandbox.js";

@Injectable()
export class PgBossWorkspaceRemovals extends WorkspaceRemovals implements OnApplicationShutdown {
  #ready: Promise<void> | undefined;

  async request(jobId: string, actor: string): Promise<void> {
    const boss = await getJobQueue();
    this.#ready ??= ensureWorkspaceCleanupQueue(boss).catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    await this.#ready;
    await sendWorkspaceCleanup(boss, { jobId, actor });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeJobQueue();
  }
}
