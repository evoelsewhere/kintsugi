import { describe, expect, it } from "vitest";
import { type DebugLogRow, captureLogs, levelOf, pgDebugLogSink, redactLogLine } from "../src/debug-log.js";

const stream = (): { write: (chunk: unknown) => boolean; written: string[] } => {
  const written: string[] = [];
  return { written, write: (chunk) => (written.push(String(chunk)), true) };
};

describe("debug log capture (ADR-0056)", () => {
  it("redacts what looks like a credential and the terminal colours", () => {
    expect(redactLogLine("\u001b[32mLOG\u001b[0m signed in with password=hunter2hunter2 ok")).toBe("LOG signed in with [redacted] ok");
    expect(redactLogLine("Authorization: Basic YWRtaW46c2VjcmV0")).toBe("[redacted]");
    expect(redactLogLine("request with Bearer abcdefghijklmnop failed")).toBe("request with [redacted] failed");
    expect(redactLogLine("connect postgres://kintsugi:s3cr3t@postgres:5432/kintsugi")).toBe("connect [redacted]postgres:5432/kintsugi");
    expect(redactLogLine("x".repeat(9000))).toHaveLength(4000);
  });

  it("reads the level from Nest's marker, then from the words, then from the stream", () => {
    expect(levelOf("[Nest] 12  - 10/22/2026, 8:00:00 AM     LOG [RoutesResolver] Mapped", "stdout")).toBe("info");
    expect(levelOf("[Nest] 12  - 10/22/2026, 8:00:00 AM    WARN [Throttle] slow", "stdout")).toBe("warn");
    expect(levelOf("[Nest] 12  - 10/22/2026, 8:00:00 AM   ERROR [Bootstrap] boom", "stdout")).toBe("error");
    expect(levelOf("[Nest] 12  - 10/22/2026, 8:00:00 AM VERBOSE [X] detail", "stdout")).toBe("debug");
    expect(levelOf("[worker] document write w1 failed: Error: nope", "stdout")).toBe("error");
    expect(levelOf("[worker] polling every 180s", "stdout")).toBe("info");
    expect(levelOf("something on stderr", "stderr")).toBe("warn");
  });

  it("mirrors both streams line by line without changing what they print, and stops cleanly", async () => {
    const out = stream();
    const err = stream();
    const rows: DebugLogRow[] = [];
    const capture = captureLogs({ service: "worker", sink: async (batch) => void rows.push(...batch), stdout: out, stderr: err, flushMs: 10_000 });
    out.write("first line\nsecond ");
    out.write("line\n\n");
    err.write("an error happened\n");
    out.write("unterminated");
    await capture.flush();
    expect(rows.map((row) => [row.service, row.level, row.message])).toEqual([
      ["worker", "info", "first line"],
      ["worker", "info", "second line"],
      ["worker", "error", "an error happened"],
    ]);
    expect(out.written).toEqual(["first line\nsecond ", "line\n\n", "unterminated"]);
    await capture.stop();
    expect(rows.at(-1)?.message).toBe("unterminated");
    out.write("after the stop\n");
    await capture.flush();
    expect(rows).toHaveLength(4);
  });

  it("keeps the lines while the sink is down, bounded, and writes them when it is back", async () => {
    const out = stream();
    const rows: string[] = [];
    let down = true;
    const capture = captureLogs({
      service: "api",
      sink: async (batch) => {
        if (down) throw new Error("not ready");
        rows.push(...batch.map((row) => row.message));
      },
      stdout: out,
      stderr: stream(),
      flushMs: 10_000,
      maxBuffered: 3,
    });
    for (const line of ["one", "two", "three", "four"]) out.write(`${line}\n`);
    await capture.flush();
    expect(rows).toEqual([]);
    down = false;
    await capture.flush();
    expect(rows).toEqual(["two", "three", "four"]);
    await capture.stop();
  });

  it("never lets a failing capture disturb the process that logs", () => {
    const out = stream();
    const capture = captureLogs({ service: "api", sink: async () => undefined, stdout: out, stderr: stream(), flushMs: 10_000 });
    expect(out.write(undefined)).toBe(true);
    // A Buffer is a Uint8Array whose toString decodes it.
    expect(out.write(Object.assign(new Uint8Array(1), { toString: () => "bytes\n" }))).toBe(true);
    void capture.stop();
  });

  it("inserts a batch with one statement and prunes now and then", async () => {
    const statements: Array<{ text: string; values: unknown[] | undefined }> = [];
    const sink = pgDebugLogSink({ query: async (text, values) => void statements.push({ text, values }) }, { retentionHours: 6, maxRows: 100 });
    const row = (message: string): DebugLogRow => ({ at: "2026-10-22T08:00:00.000Z", service: "api", level: "info", message });
    await sink([row("a"), row("b")]);
    expect(statements.map((entry) => entry.text.split(" ").slice(0, 3).join(" "))).toEqual(["insert into monitoring.debug_log", "delete from monitoring.debug_log", "delete from monitoring.debug_log"]);
    expect(statements[0]?.values?.[3]).toEqual(["a", "b"]);
    expect(statements[1]?.values).toEqual([6]);
    expect(statements[2]?.values).toEqual([100]);
    await sink([row("c")]);
    expect(statements).toHaveLength(4);
  });
});
