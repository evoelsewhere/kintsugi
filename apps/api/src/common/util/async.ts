// Shared kernel: async utilities (scheduling, retries, batching).

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
