// Shared kernel: async utilities (scheduling, retries, batching).

/** Waits `ms`; resolves early (never rejects) when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * A gate that lets at most `max` tasks run at once; the others wait their turn, in order. A task that fails frees its
 * place like one that succeeds.
 */
export function limitConcurrency(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      // The place passes to the next waiting task, or is given back.
      const next = waiting.shift();
      if (next !== undefined) next();
      else running--;
    }
  };
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Return false to stop retrying early (e.g. non-retryable status). */
  retryIf?: (error: unknown) => boolean;
}

/** Retries an async operation with a fixed delay between attempts. */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 250;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (options.retryIf !== undefined && !options.retryIf(error)) throw error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size) as T[]);
  }
  return result;
}
