// Queue adapter: hands a document write to the worker's writer through pg-boss (queue
// `document-write`, one write per document repository at a time — ADR-0019).

import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ensureDocumentWriteQueue, sendDocumentWrite } from "@kintsugi/orchestrator/queues";
import { closeJobQueue, getJobQueue } from "#common/queue/job-queue.js";
import type { NewDocumentWrite } from "../domain/document-write.js";
import { DocumentWriteQueue } from "../domain/document-write.ports.js";

@Injectable()
export class PgBossDocumentWriteQueue extends DocumentWriteQueue implements OnApplicationShutdown {
  #ready: Promise<void> | undefined;

  async enqueue(write: NewDocumentWrite): Promise<void> {
    const boss = await getJobQueue();
    // The worker creates the queue too; creating it here lets the API enqueue before the worker's first start.
    this.#ready ??= ensureDocumentWriteQueue(boss).catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    await this.#ready;
    await sendDocumentWrite(boss, write.documentRepositoryId, {
      writeId: write.id,
      projectId: write.projectId,
      kind: write.kind,
      message: write.message,
      files: write.files.map((file) => ({ path: file.path, content: file.content })),
      ...(write.actor === undefined ? {} : { actor: write.actor }),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeJobQueue();
  }
}
