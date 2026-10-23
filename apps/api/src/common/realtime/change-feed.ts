// Change notifications (migration 026): Postgres tells this process, over one LISTEN connection, which topic
// changed and whose (a project id; a run id for job-events), so streams wake up when something happened instead of
// asking the database on a timer. The notice carries no row content. A connection that drops is opened again with
// backoff, and every listener gets `resync` then: whatever it follows may have changed while it was away.

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import pg from "pg";

export const CHANGE_CHANNEL = "kintsugi_change";

/** What changed: the topic (`job-runs`, `document-writes`, …) and its scope ("" when it has none). */
export interface Change {
  topic: string;
  scope: string;
}

export type ChangeListener = (change: Change | "resync") => void;

/** Follows the changes that match; remembers one that arrived while the caller was busy so it is never missed. */
export interface Watcher {
  /** Forgets earlier changes: call it before reading what the watcher follows. */
  clear(): void;
  /** Resolves when something matched since the last `clear` (at once if it did already), after `timeoutMs` at the latest, or when aborted. */
  wait(timeoutMs: number): Promise<void>;
  close(): void;
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

@Injectable()
export class ChangeFeed implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ChangeFeed.name);
  private readonly listeners = new Set<ChangeListener>();
  private client: pg.Client | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private stopped = false;

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  /** Calls `listener` for every change (and `resync` after a reconnect); returns the unsubscribe function. */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watch(match: (change: Change) => boolean, signal?: AbortSignal): Watcher {
    let pending = false;
    let wake: (() => void) | undefined;
    const notify = (): void => {
      pending = true;
      wake?.();
    };
    const unsubscribe = this.subscribe((change) => {
      if (change === "resync" || match(change)) notify();
    });
    signal?.addEventListener("abort", notify, { once: true });
    return {
      clear: () => {
        pending = false;
      },
      wait: (timeoutMs) =>
        new Promise<void>((resolve) => {
          if (pending || signal?.aborted === true) return resolve();
          const done = (): void => {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          };
          const timer = setTimeout(done, timeoutMs);
          wake = done;
        }),
      close: unsubscribe,
    };
  }

  private async connect(): Promise<void> {
    const url = process.env["DATABASE_URL"];
    if (this.stopped || url === undefined || url.length === 0) return;
    const client = new pg.Client({ connectionString: url });
    const lost = (): void => {
      if (this.client !== client) return;
      this.client = undefined;
      void client.end().catch(() => undefined);
      this.reconnect();
    };
    client.on("error", lost);
    client.on("end", lost);
    client.on("notification", (message) => {
      if (message.channel !== CHANGE_CHANNEL || message.payload === undefined) return;
      try {
        const body = JSON.parse(message.payload) as { t?: unknown; s?: unknown };
        if (typeof body.t === "string") this.emit({ topic: body.t, scope: typeof body.s === "string" ? body.s : "" });
      } catch {
        // A notice that is not ours is ignored.
      }
    });
    try {
      await client.connect();
      await client.query(`listen ${CHANGE_CHANNEL}`);
      this.client = client;
      if (this.failures > 0) this.emit("resync");
      this.failures = 0;
    } catch (error) {
      void client.end().catch(() => undefined);
      this.log.warn(`Change feed is not connected: ${error instanceof Error ? error.message : String(error)}`);
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.stopped || this.retry !== undefined) return;
    this.failures += 1;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(this.failures - 1, 5));
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, delay);
  }

  private emit(change: Change | "resync"): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // A listener never stops the others.
      }
    }
  }
}
