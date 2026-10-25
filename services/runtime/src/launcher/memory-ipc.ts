import type { JobServices } from "@kintsugi/runtime-sdk";
import { MemoryRequestError } from "@kintsugi/runtime-sdk";
import { createJobServiceIpcClient } from "./job-service-ipc.js";

/** Child-side bridge; scope and database credentials stay in the worker. */
export function createMemoryIpcClient(): { memory: NonNullable<JobServices["memory"]>; dispose(): void } {
  const client = createJobServiceIpcClient("memory", 10_000, (message) => new MemoryRequestError(message));
  return { memory: client.call, dispose: client.dispose };
}
