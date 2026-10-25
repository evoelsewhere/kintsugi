import type { JobServices, MemoryOperation } from "@kintsugi/runtime-sdk";
import { MemoryRequestError } from "@kintsugi/runtime-sdk";

/** Child-side bridge to the caller-bound host service; never carries database credentials. */
export function createMemoryIpcClient(): { memory: NonNullable<JobServices["memory"]>; dispose(): void } {
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const message = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const reply = value as { type?: string; id?: number; ok?: boolean; value?: unknown; error?: unknown };
    if (reply.type !== "memory.result" || reply.id === undefined) return;
    const request = pending.get(reply.id);
    if (request === undefined) return;
    if (reply.ok === true) request.resolve(reply.value);
    else request.reject(new MemoryRequestError(typeof reply.error === "string" ? reply.error.slice(0, 300) : "Live memory request failed; try again or continue without memory"));
  };
  const disconnected = (): void => {
    for (const request of [...pending.values()]) request.reject(new Error("Memory service disconnected"));
  };
  process.on("message", message);
  process.on("disconnect", disconnected);
  return {
    memory: (operation: MemoryOperation, input: unknown, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
      if (signal?.aborted || !process.connected || process.send === undefined) { reject(new Error("Memory service unavailable")); return; }
      if (pending.size >= 8) { reject(new Error("Too many concurrent memory requests")); return; }
      const id = ++sequence;
      const finish = (value: unknown, error?: Error): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        pending.delete(id);
        if (error === undefined) resolve(value); else reject(error);
      };
      const abort = (): void => finish(undefined, new Error("Memory request aborted"));
      const timer = setTimeout(() => finish(undefined, new Error("Memory request timed out")), 10_000);
      pending.set(id, { resolve: (value) => finish(value), reject: (error) => finish(undefined, error) });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        process.send({ type: "memory.call", id, operation, input }, (error: Error | null) => { if (error !== null) finish(undefined, new Error("Memory request could not be sent")); });
      } catch { finish(undefined, new Error("Memory request could not be sent")); }
    }),
    dispose: () => {
      process.off("message", message);
      process.off("disconnect", disconnected);
      disconnected();
      if (process.connected) { try { process.disconnect(); } catch { /* Already disconnected. */ } }
    },
  };
}
