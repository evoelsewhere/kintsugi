import { JobServiceRequestError } from "@kintsugi/runtime-sdk";

/** Correlated private IPC for caller-bound tools. A client owns only its own listener and pending calls. */
export function createJobServiceIpcClient(channel: string, timeoutMs: number, safeError: (message: string) => JobServiceRequestError) {
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const message = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const reply = value as { type?: string; id?: number; ok?: boolean; value?: unknown; error?: unknown };
    if (reply.type !== `${channel}.result` || reply.id === undefined) return;
    const request = pending.get(reply.id);
    if (request === undefined) return;
    if (reply.ok === true) request.resolve(reply.value);
    else request.reject(safeError(typeof reply.error === "string" ? reply.error.slice(0, 300) : "Tool service unavailable; continue without it"));
  };
  const disconnected = (): void => {
    for (const request of [...pending.values()]) request.reject(new Error("Tool service disconnected"));
  };
  process.on("message", message);
  process.on("disconnect", disconnected);
  return {
    call: (operation: string, input: unknown, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
      if (signal?.aborted || !process.connected || process.send === undefined) { reject(new Error("Tool service unavailable")); return; }
      if (pending.size >= 8) { reject(new Error("Too many concurrent tool requests")); return; }
      const id = ++sequence;
      const finish = (value: unknown, error?: Error): void => {
        if (!pending.has(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        pending.delete(id);
        if (error === undefined) resolve(value); else reject(error);
      };
      const cancel = (): void => {
        if (process.connected) { try { process.send?.({ type: `${channel}.cancel`, id }, () => undefined); } catch { /* Already disconnected. */ } }
      };
      const abort = (): void => { cancel(); finish(undefined, new Error("Tool request aborted")); };
      const timer = setTimeout(() => { cancel(); finish(undefined, new Error("Tool request timed out")); }, timeoutMs);
      pending.set(id, { resolve: (value) => finish(value), reject: (error) => finish(undefined, error) });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        process.send({ type: `${channel}.call`, id, operation, input }, (error: Error | null) => { if (error !== null) finish(undefined, new Error("Tool request could not be sent")); });
      } catch { finish(undefined, new Error("Tool request could not be sent")); }
    }),
    dispose: (): void => {
      process.off("message", message);
      process.off("disconnect", disconnected);
      disconnected();
    },
  };
}
