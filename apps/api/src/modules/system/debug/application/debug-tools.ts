// The tools of the debug MCP server (ADR-0056), grouped as a person debugging a run would reach for them: the run,
// its sandbox on disk, the logs of the services, the system around it, and the database. Every tool reads.

import { z } from "zod";
import { type FileText, type Json, LOG_SERVICES, type DebugStore, type WorkspaceFiles } from "../domain/debug.js";
import type { McpTool } from "./mcp-protocol.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;
const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

/** `15m`, `2h`, `1d` before now, or an ISO time. */
export function sinceOf(text: string, now: Date = new Date()): Date {
  const relative = /^(\d{1,4})\s*([mhd])$/.exec(text.trim());
  if (relative !== null) return new Date(now.getTime() - Number(relative[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as "m" | "h" | "d"]);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`"${text}" is not a time: use 15m, 2h, 1d or an ISO date`);
  return parsed;
}

const since = z.string().optional().describe("From this time on: 15m, 2h, 1d (before now) or an ISO date");
const runId = z.string().min(1).max(128).describe("The id of a run (a top-level job run, as `runs.list` shows it)");
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);

/** Statements `db.query` accepts: one select or with, nothing that changes or explains. */
export function checkStatement(sql: string): string {
  const text = sql.trim().replace(/;\s*$/, "");
  if (text === "") throw new Error("The statement is empty");
  if (text.includes(";")) throw new Error("One statement only");
  if (!/^(select|with)\b/i.test(text)) throw new Error("Only select and with statements run here");
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|call|do|set|reset|lock|listen|notify)\b/i.test(text.replace(/'[^']*'/g, "''"))) {
    throw new Error("The statement contains a keyword that changes things; this tool only reads");
  }
  return text;
}

export function debugTools(store: DebugStore, files: WorkspaceFiles): ReadonlyMap<string, McpTool<void>> {
  const tools: Array<McpTool<void>> = [];
  const tool = <Shape extends z.ZodRawShape>(name: string, description: string, shape: Shape, run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>): void => {
    tools.push({ name, description, input: z.object(shape), run: run as McpTool<void>["run"] });
  };
  const missing = (what: string): never => {
    throw new Error(`${what} not found`);
  };

  // ------------------------------------------------------------------ runs
  tool("runs.list", "The latest top-level job runs (stages, scripts, agent jobs), newest first: status, attempt, the start of the failure reason, how many steps failed.", {
    projectId: z.string().optional(),
    applicationId: z.string().optional(),
    status: z.array(z.enum(STATUSES)).optional().describe("Only runs in these states"),
    limit: limit(50, 15),
  }, async (args) => ({ runs: await store.runs({ ...(args.projectId === undefined ? {} : { projectId: args.projectId }), ...(args.applicationId === undefined ? {} : { applicationId: args.applicationId }), ...(args.status === undefined ? {} : { statuses: args.status }), limit: args.limit }) }));

  tool("runs.get", "One run with its steps (status, agent, usage, failure), attempts, sources, document write, artifact count and the inputs it was started with.", { runId }, async (args) => (await store.run(args.runId)) ?? missing(`Run ${args.runId}`));

  tool("runs.step", "One step of a run: the inputs it ran with (the agent's task text included) and the summary it recorded (usage, outcome, hook results). Give a step id from `runs.get`.", { stepId: z.string().min(1).max(128) }, async (args) => (await store.step(args.stepId)) ?? missing(`Step ${args.stepId}`));

  tool("runs.events", "The live record of a run, as the portal's log shows it: status changes, steps, agent tool calls (tool and path), log lines. Pages with `cursor`; filter by kind, step, attempt or text.", {
    runId,
    order: z.enum(["asc", "desc"]).default("asc").describe("`desc` gives the newest first, for the end of a long run"),
    cursor: z.string().regex(/^\d{1,18}$/).optional().describe("The id of the last event seen: the next page starts after it (asc) or before it (desc)"),
    limit: limit(500, 100),
    kinds: z.array(z.enum(["status", "step.started", "step.finished", "tool", "log"])).optional(),
    stepId: z.string().optional(),
    attempt: z.number().int().min(1).optional(),
    text: z.string().max(200).optional().describe("Only events whose message contains this"),
  }, async (args) => {
    const events = await store.events({
      runId: args.runId,
      order: args.order,
      limit: args.limit,
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
      ...(args.stepId === undefined ? {} : { stepId: args.stepId }),
      ...(args.attempt === undefined ? {} : { attempt: args.attempt }),
      ...(args.text === undefined ? {} : { text: args.text }),
    });
    return { count: events.length, nextCursor: events.length === args.limit ? (events.at(-1)?.["id"] ?? null) : null, events };
  });

  tool("runs.failure", "Start here for a run that failed: the failed steps with their reasons, the last events of the latest attempt, the events that mention a failure or a blocked call, and the warnings and errors the API and the worker logged while it ran.", { runId }, async (args) => (await store.failure(args.runId)) ?? missing(`Run ${args.runId}`));

  tool("runs.telemetry", "Model usage of a run per step and attempt: turns, tool calls, retries, errors, time; and the spans that ended in an error.", { runId }, async (args) => store.telemetry(args.runId));

  tool("runs.ledger", "What the latest attempt of a stage did with each step, from the job's workspace: the ledger entries (status, attempt, fingerprint, files written), the gate choices, the manifest (pins, state, attempt) and the step folders left on disk. A step that ran again shows the attempt that last ran it.", { runId }, async (args) => {
    const state = await files.state(args.runId);
    const ledger = state.ledger as { entries?: Record<string, Json>; gates?: Json } | undefined;
    const entries = Object.entries(ledger?.entries ?? {}).map(([key, entry]) => ({
      key,
      status: entry["status"],
      attempt: entry["attempt"],
      fingerprint: String(entry["fingerprint"] ?? "").slice(0, 12),
      digest: String(entry["digest"] ?? "").slice(0, 12),
      files: Array.isArray(entry["outputs"]) ? entry["outputs"].length : 0,
      finishedAt: entry["finishedAt"],
      ...(entry["reason"] === undefined ? {} : { reason: entry["reason"] }),
    }));
    return { manifest: state.manifest ?? null, ledger: { entries, gates: ledger?.gates ?? {} }, stepFolders: state.stepFolders };
  });

  // ------------------------------------------------------------------ the sandbox
  tool("workspace.jobs", "The job workspaces on this server's data volume, newest first: the job, its run status, its manifest (state, attempt, sources, whether the checkouts were dropped) and what is at its top level.", { limit: limit(100, 30) }, async (args) => {
    const dirs = await files.jobs(args.limit);
    const states = await store.runStates(dirs.map((dir) => dir.id));
    return { disk: await files.disk(), jobs: dirs.map((dir) => ({ ...dir, run: states.get(dir.id) ?? null })) };
  });

  tool("workspace.tree", "The files of a job's workspace: `as-is/`, `to-be/`, `docs/`, `out/`, `work/`, `steps/<step>/`, `.state/`. Folders are listed to a depth; a folder past it says how many entries it has.", {
    runId,
    path: z.string().max(500).default("").describe("A folder or file inside the workspace; empty for its root"),
    depth: z.number().int().min(1).max(6).default(2),
    limit: limit(500, 200),
  }, async (args) => ({ job: args.runId, path: args.path, ...(await files.tree(args.runId, args.path, args.depth, args.limit)) }));

  tool("workspace.read", "The text of a file in a job's workspace (at most 100 kB per call; read on with `offset`). A binary file says so. Nothing outside the workspace can be read.", {
    runId,
    path: z.string().min(1).max(500),
    offset: z.number().int().min(0).default(0),
    length: z.number().int().min(1).max(100_000).default(20_000),
  }, async (args): Promise<FileText> => files.read(args.runId, args.path, args.offset, args.length));

  // ------------------------------------------------------------------ logs
  tool("logs.tail", "The latest lines the API and the worker printed (captured when KINTSUGI_DEBUG_MCP=1 is set on both), oldest first. Also says what was captured per service.", {
    service: z.enum(LOG_SERVICES).optional().describe("api or worker; both when absent"),
    minLevel: z.enum(LEVELS).default("info"),
    since,
    lines: limit(500, 100),
  }, async (args) => ({
    capture: await store.logCapture(),
    lines: await store.logs({ minLevel: args.minLevel, limit: args.lines, ...(args.service === undefined ? {} : { service: args.service }), ...(args.since === undefined ? {} : { since: sinceOf(args.since) }) }),
  }));

  tool("logs.search", "Search the captured log lines with a regular expression (case-insensitive), by service, level and time, newest matches last. `context` adds the lines of the same service around each hit (at most 20 hits then).", {
    pattern: z.string().min(1).max(300),
    service: z.enum(LOG_SERVICES).optional(),
    minLevel: z.enum(LEVELS).default("debug"),
    since,
    until: z.string().optional().describe("Up to this time (ISO date or 15m, 2h, 1d before now)"),
    limit: limit(200, 50),
    context: z.number().int().min(0).max(10).default(0),
  }, async (args) => {
    const hits = await store.logs({
      minLevel: args.minLevel,
      pattern: args.pattern,
      limit: args.context > 0 ? Math.min(args.limit, 20) : args.limit,
      ...(args.service === undefined ? {} : { service: args.service }),
      ...(args.since === undefined ? {} : { since: sinceOf(args.since) }),
      ...(args.until === undefined ? {} : { until: sinceOf(args.until) }),
    });
    if (args.context === 0) return { hits };
    const around: Json[] = [];
    for (const hit of hits) around.push({ hit: hit["id"], lines: await store.logsAround(String(hit["id"]), args.context, args.context) });
    return { hits: hits.length, around };
  });

  // ------------------------------------------------------------------ the system
  tool("system.status", "One look at the whole installation: the API (build, uptime, memory), the database (size, connections, migrations), each worker's heartbeat and whether it is up, the runs by status, the repositories by sync status and the data volume.", {}, async () => ({ ...(await store.status()), disk: await files.disk(), logCapture: await store.logCapture() }));

  tool("queues.list", "The pg-boss queues of the worker (queued, active, deferred, total) and the latest jobs that failed or are being retried, with their error output.", {}, async () => store.queues());

  tool("repos.status", "Every registered Git repository: sync status, last commit, last sync and the last error (repositories with an error first).", {}, async () => ({ repositories: await store.repositories() }));

  // ------------------------------------------------------------------ the database
  tool("db.tables", "The tables of the installation's database with an estimate of their rows; with `schema` and `table`, the columns of one. Schemas: core, admin, delivery, monitoring, governance, knowledge, workflow.", {
    schema: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
    table: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  }, async (args) => store.tables(args.schema, args.table));

  tool("db.query", "One read-only select or with statement against the database (five seconds, at most 200 rows, long values cut). Tables that hold secrets and sessions are refused. Use `db.tables` to find the columns.", {
    sql: z.string().min(1).max(4000),
    limit: limit(200, 50),
  }, async (args) => store.query(checkStatement(args.sql), args.limit));

  return new Map(tools.map((entry) => [entry.name, entry]));
}
