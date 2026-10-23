import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in for the browser's EventSource: the test plays the server. */
class FakeSource {
  static all: FakeSource[] = [];
  closed = false;
  private readonly handlers = new Map<string, Array<(message: { data: string }) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, handler: (message: { data: string }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown = {}): void {
    for (const handler of this.handlers.get(type) ?? []) handler({ data: JSON.stringify(data) });
  }
}

const hidden = { value: false };
let visibility: (() => void) | undefined;

async function load(): Promise<typeof import("./live")> {
  vi.resetModules();
  return import("./live");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.all = [];
  hidden.value = false;
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal("document", {
    get hidden() {
      return hidden.value;
    },
    addEventListener: (_type: string, handler: () => void) => {
      visibility = handler;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const change = (topic: string, scope = ""): { changes: Array<{ topic: string; scope: string }> } => ({ changes: [{ topic, scope }] });

describe("live updates", () => {
  it("opens one stream for all subscribers and calls only those whose topic changed", async () => {
    const { subscribeLive } = await load();
    const runs = vi.fn();
    const gates = vi.fn();
    subscribeLive(["job-runs"], runs);
    subscribeLive(["gates"], gates);
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]?.url).toBe("/api/events");

    FakeSource.all[0]?.emit("change", change("job-runs", "billing"));
    expect(runs).toHaveBeenCalledTimes(1);
    expect(gates).not.toHaveBeenCalled();
  });

  it("follows one project only when the spec has a scope", async () => {
    const { subscribeLive } = await load();
    const mine = vi.fn();
    subscribeLive(["job-runs:billing"], mine);
    FakeSource.all[0]?.emit("change", change("job-runs", "other"));
    expect(mine).not.toHaveBeenCalled();
    FakeSource.all[0]?.emit("change", change("job-runs", "billing"));
    expect(mine).toHaveBeenCalledTimes(1);
  });

  it("reads again at most once in a while, and once more for what came meanwhile", async () => {
    const { subscribeLive } = await load();
    const runs = vi.fn();
    subscribeLive(["job-runs"], runs);
    const source = FakeSource.all[0]!;
    source.emit("change", change("job-runs"));
    source.emit("change", change("job-runs"));
    source.emit("change", change("job-runs"));
    expect(runs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it("waits while the tab is hidden and reads when it shows again", async () => {
    const { subscribeLive } = await load();
    const runs = vi.fn();
    subscribeLive(["job-runs"], runs);
    hidden.value = true;
    FakeSource.all[0]?.emit("change", change("job-runs"));
    expect(runs).not.toHaveBeenCalled();
    hidden.value = false;
    visibility?.();
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it("reads everything again after a reconnect or a resync, not after the first open", async () => {
    const { subscribeLive } = await load();
    const runs = vi.fn();
    subscribeLive(["job-runs"], runs);
    const source = FakeSource.all[0]!;
    source.emit("open");
    expect(runs).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    source.emit("open");
    expect(runs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    source.emit("resync");
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it("closes the stream a while after the last subscriber left, and not before", async () => {
    const { subscribeLive } = await load();
    const stop = subscribeLive(["job-runs"], vi.fn());
    stop();
    expect(FakeSource.all[0]?.closed).toBe(false);
    const again = subscribeLive(["gates"], vi.fn());
    await vi.advanceTimersByTimeAsync(6000);
    expect(FakeSource.all[0]?.closed).toBe(false);
    again();
    await vi.advanceTimersByTimeAsync(6000);
    expect(FakeSource.all[0]?.closed).toBe(true);
  });
});
