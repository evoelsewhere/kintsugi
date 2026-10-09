// Minimal async event queue used to expose job events as an AsyncIterable
// (JobHandle.events). Push is non-blocking; consumers pull at their own pace.

type Waiter<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
};

export class EventStream<T> implements AsyncIterable<T> {
  readonly #buffer: T[] = [];
  readonly #waiters: Array<Waiter<T>> = [];
  #ended = false;
  #error: unknown = undefined;

  push(item: T): void {
    if (this.#ended) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ value: item, done: false });
    else this.#buffer.push(item);
  }

  /** Ends the stream normally; pending and future reads complete. */
  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  /** Ends the stream with an error; pending and future reads reject. */
  fail(error: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#error = error;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.#buffer.length > 0) {
      const value = this.#buffer.shift();
      return { value: value as T, done: false };
    }
    if (this.#error !== undefined) throw this.#error;
    if (this.#ended) return { value: undefined, done: true };
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}
