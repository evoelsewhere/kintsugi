import { JobServiceRequestError, memoryToolName, type JobServices, type JobSpec, type MemoryOperation } from "@kintsugi/runtime-sdk";

/** Admission and cancellation shared by the private caller-bound tool services. */
export function createJobServiceHost(spec: JobSpec, services: JobServices, signal: AbortSignal) {
  const pending = new Map<string, AbortController>();
  const counts = new Map<string, number>();
  return (value: unknown, reply: (message: object) => void): void => {
    if (typeof value !== "object" || value === null || Buffer.byteLength(JSON.stringify(value), "utf8") > 16_000) return;
    const request = value as { type?: string; id?: number; operation?: string; input?: unknown };
    if (!Number.isSafeInteger(request.id) || request.id! < 1) return;
    const channel = request.type?.split(".")[0];
    if (channel !== "memory" && channel !== "web-search") return;
    const key = `${channel}:${request.id}`;
    if (request.type === `${channel}.cancel`) { pending.get(key)?.abort(); return; }
    if (request.type !== `${channel}.call`) return;
    const refuse = (): void => reply({ type: `${channel}.result`, id: request.id, ok: false });
    const count = (counts.get(channel) ?? 0) + 1;
    counts.set(channel, count);
    const memory = channel === "memory";
    const allowed = memory
      ? spec.memory !== undefined && services.memory !== undefined &&
        ["search","read","write","status","forget","restore","scratchpad"].includes(request.operation ?? "") &&
        spec.agent.tools.includes(memoryToolName(request.operation as MemoryOperation)) &&
        (!["write","forget","restore","scratchpad"].includes(request.operation!) || spec.memory.writeSchema !== undefined)
      : spec.webSearch === true && services.webSearch !== undefined && request.operation === "search" && spec.agent.tools.includes("web_search");
    if (!allowed || signal.aborted || pending.has(key) || pending.size >= 8 || count > (memory ? 512 : 32)) { refuse(); return; }
    const controller = new AbortController();
    pending.set(key, controller);
    const requestSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(memory ? 10_000 : 23_000)]);
    void Promise.resolve().then(() => memory
      ? services.memory!(request.operation as MemoryOperation, request.input, requestSignal)
      : services.webSearch!(request.input, requestSignal)).then(
      (result) => {
        if (requestSignal.aborted || Buffer.byteLength(JSON.stringify(result ?? null), "utf8") > 12_000) { refuse(); return; }
        reply({ type: `${channel}.result`, id: request.id, ok: true, value: result });
      },
      (error: unknown) => reply({ type: `${channel}.result`, id: request.id, ok: false,
        ...(error instanceof JobServiceRequestError ? { error: error.message.slice(0, 300) } : {}),
      }),
    ).catch(refuse).finally(() => { pending.delete(key); });
  };
}
