// Queue adapter: hands a job run to the worker through pg-boss (queue `job-run`, ADR-0003).

import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ensureJobRunQueue, sendJobRun } from "@kintsugi/orchestrator/queues";
import { closeJobQueue, getJobQueue } from "#common/queue/job-queue.js";
import { JobRunQueue } from "../domain/job-run.ports.js";

@Injectable()
export class PgBossJobRunQueue extends JobRunQueue implements OnApplicationShutdown {
  #ready: Promise<void> | undefined;

  async enqueue(jobRunId: string): Promise<void> {
    const boss = await getJobQueue();
    // The worker creates the queue too; creating it here lets the API enqueue before the worker's first start.
    this.#ready ??= ensureJobRunQueue(boss).catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    await this.#ready;
    await sendJobRun(boss, { jobRunId });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeJobQueue();
  }
}
