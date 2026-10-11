// Queue health adapter: job counts of the worker's queues from pg-boss (ADR-0003). Queue names
// come from `@kintsugi/orchestrator/queues`, so both sides agree on them; a queue the worker has
// not created yet counts as empty.

import { Injectable } from "@nestjs/common";
import { DOCUMENT_WRITE_QUEUE, GIT_SYNC_QUEUE, JOB_RUN_QUEUE } from "@kintsugi/orchestrator/queues";
import { getJobQueue } from "#common/queue/job-queue.js";
import type { QueueCount } from "../domain/overview.js";
import { QueueHealth } from "../domain/overview.ports.js";

const WORKER_QUEUES = [JOB_RUN_QUEUE, DOCUMENT_WRITE_QUEUE, GIT_SYNC_QUEUE];

@Injectable()
export class PgBossQueueHealth extends QueueHealth {
  async queues(): Promise<QueueCount[]> {
    const boss = await getJobQueue();
    const results = await boss.getQueues(WORKER_QUEUES);
    return WORKER_QUEUES.map((name) => {
      const result = results.find((entry) => entry.name === name);
      return { name, queued: result?.queuedCount ?? 0, active: result?.activeCount ?? 0, deferred: result?.deferredCount ?? 0 };
    });
  }
}
