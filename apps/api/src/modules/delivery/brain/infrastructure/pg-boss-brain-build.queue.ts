// Asks the worker for a Brain build through its pg-boss queue (`brain-index`, one per project at a time).

import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ensureBrainIndexQueue, sendBrainIndex } from "@kintsugi/orchestrator/queues";
import { closeJobQueue, getJobQueue } from "#common/queue/job-queue.js";
import { BrainBuildQueue } from "../domain/brain.ports.js";

@Injectable()
export class PgBossBrainBuildQueue extends BrainBuildQueue implements OnApplicationShutdown {
  #ready: Promise<void> | undefined;

  async enqueue(projectId: string): Promise<void> {
    const boss = await getJobQueue();
    this.#ready ??= ensureBrainIndexQueue(boss).catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    await this.#ready;
    await sendBrainIndex(boss, { projectId });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeJobQueue();
  }
}
