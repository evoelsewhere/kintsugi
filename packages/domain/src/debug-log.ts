// Log capture for development installations (ADR-0056). When debugging is on, a process mirrors what it prints to its
// standard output and error, line by line, to a sink (a table the debug MCP server reads), redacted of credentials.
// Pure: it takes the streams and the sink, knows no database and no process, and never lets a failing sink disturb the
// process that is logging.

export const DEBUG_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type DebugLogLevel = (typeof DEBUG_LOG_LEVELS)[number];

export interface DebugLogRow {
  at: string;
  service: string;
  level: DebugLogLevel;
  message: string;
}

export type DebugLogSink = (rows: readonly DebugLogRow[]) => Promise<void>;

/** What a stream must offer to be captured: `write`, as every Node writable does. */
export interface LogStream {
  write: (...args: never[]) => boolean;
}

/** The longest line kept; the rest is cut. */
export const MAX_LOG_LINE = 4000;

// Terminal colours start with the escape character.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const SECRETISH = [
  /\b(authorization|proxy-authorization)\s*[:=]\s*(basic|bearer)?\s*[A-Za-z0-9+/=._~-]{6,}/gi,
  /\bbearer\s+[A-Za-z0-9+/=._~-]{8,}/gi,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|credential|cookie)s?\b\s*[:=]\s*\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/** A log line without terminal colours and without anything credential-shaped. */
export function redactLogLine(text: string): string {
  return SECRETISH.reduce((result, pattern) => result.replace(pattern, "[redacted]"), text.replace(ANSI, "")).slice(0, MAX_LOG_LINE);
}

const NEST = /\s(VERBOSE|DEBUG|LOG|WARN|ERROR|FATAL)\s+\[/;

/** The level of a line: Nest's own marker, else what the words and the stream say. */
export function levelOf(line: string, stream: "stdout" | "stderr"): DebugLogLevel {
  const nest = NEST.exec(line)?.[1];
  if (nest !== undefined) return nest === "LOG" ? "info" : nest === "WARN" ? "warn" : nest === "ERROR" || nest === "FATAL" ? "error" : "debug";
  if (/\b(error|fatal|exception|unhandled|failed|failure)\b/i.test(line)) return "error";
  if (/\bwarn(ing)?\b/i.test(line)) return "warn";
  return stream === "stderr" ? "warn" : "info";
}

export interface CaptureOptions {
  service: string;
  sink: DebugLogSink;
  stdout: LogStream;
  stderr: LogStream;
  /** Milliseconds between flushes (default 1000). */
  flushMs?: number;
  /** Lines kept while the sink cannot take them; the oldest go first (default 5000). */
  maxBuffered?: number;
}

export interface Capture {
  /** Writes what is buffered now. */
  flush(): Promise<void>;
  /** Stops capturing, restores the streams and writes what is left. */
  stop(): Promise<void>;
}

type Write = (chunk: unknown, ...rest: unknown[]) => boolean;

export function captureLogs(options: CaptureOptions): Capture {
  const maxBuffered = options.maxBuffered ?? 5000;
  let buffered: DebugLogRow[] = [];
  let flushing: Promise<void> = Promise.resolve();
  const partial = { stdout: "", stderr: "" };

  const take = (name: "stdout" | "stderr", chunk: unknown): void => {
    // A string, or a Buffer (whose toString decodes UTF-8); anything else is not text.
    const text = typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? (chunk as { toString(encoding?: string): string }).toString("utf8") : "";
    if (text === "") return;
    const lines = (partial[name] + text).split(/\r?\n/);
    partial[name] = lines.pop() ?? "";
    for (const raw of lines) {
      const message = redactLogLine(raw).trimEnd();
      if (message === "") continue;
      buffered.push({ at: new Date().toISOString(), service: options.service, level: levelOf(message, name), message });
    }
    if (buffered.length > maxBuffered) buffered = buffered.slice(buffered.length - maxBuffered);
  };

  const originals: Array<[LogStream, Write]> = [];
  for (const [name, stream] of [["stdout", options.stdout], ["stderr", options.stderr]] as const) {
    const original = stream.write as unknown as Write;
    originals.push([stream, original]);
    (stream as unknown as { write: Write }).write = function patched(this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
      try {
        take(name, chunk);
      } catch {
        // Capturing never breaks logging.
      }
      return original.call(this, chunk, ...rest);
    };
  }

  const flush = (): Promise<void> => {
    flushing = flushing.then(async () => {
      if (buffered.length === 0) return;
      const rows = buffered;
      buffered = [];
      try {
        await options.sink(rows);
      } catch {
        // The sink is not ready or is down: keep the lines (bounded) and try again at the next flush.
        buffered = [...rows, ...buffered].slice(-maxBuffered);
      }
    });
    return flushing;
  };
  const timer = setInterval(() => void flush(), options.flushMs ?? 1000);
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    flush,
    async stop() {
      clearInterval(timer);
      for (const [stream, original] of originals) (stream as unknown as { write: Write }).write = original;
      for (const name of ["stdout", "stderr"] as const) {
        if (partial[name] !== "") take(name, "\n");
      }
      await flush();
    },
  };
}

/** What a sink needs of a database client. */
export interface SinkDatabase {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

export interface PgSinkOptions {
  /** Hours a line is kept (default 24). */
  retentionHours?: number;
  /** Lines kept in all (default 200 000). */
  maxRows?: number;
}

/** A sink that inserts into `monitoring.debug_log` and, now and then, deletes what is older or beyond the cap. */
export function pgDebugLogSink(db: SinkDatabase, options: PgSinkOptions = {}): DebugLogSink {
  const retentionHours = options.retentionHours ?? 24;
  const maxRows = options.maxRows ?? 200_000;
  let lastPrune = 0;
  return async (rows) => {
    await db.query(
      "insert into monitoring.debug_log (at, service, level, message) select * from unnest($1::timestamptz[], $2::text[], $3::text[], $4::text[])",
      [rows.map((row) => row.at), rows.map((row) => row.service), rows.map((row) => row.level), rows.map((row) => row.message)],
    );
    if (Date.now() - lastPrune < 5 * 60_000) return;
    lastPrune = Date.now();
    await db.query("delete from monitoring.debug_log where at < now() - make_interval(hours => $1)", [retentionHours]);
    await db.query("delete from monitoring.debug_log where id <= (select max(id) from monitoring.debug_log) - $1", [maxRows]);
  };
}
