// Runtime telemetry (integration): the views over monitoring.telemetry_span, gated by telemetry.view
// (ADR-0048). Spans are seeded the way the worker stores them.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../support/app.js";

interface Summary {
  totals: Record<string, number | null>;
  daily: Array<{ day: string; jobs: number; inputTokens: number; costUsd: number }>;
  byAgent: Array<{ key: string; jobs: number; failedJobs: number; costUsd: number }>;
  byModel: Array<{ key: string; jobs: number }>;
  compactionReasons: Array<{ reason: string; count: number }>;
  tools: Array<{ tool: string; calls: number; errors: number; p95Ms: number | null }>;
}

interface Run {
  runId: string;
  stepRunId: string | null;
  agent: string;
  attempt: number;
  outcome: string;
  status: string;
  inputTokens: number;
  cacheReadTokens: number;
  compactions: number;
  contextPeakPercent: number | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

interface Trace {
  runId: string;
  spans: Array<{ spanId: string; parentSpanId: string | null; name: string; step: string | null; attempt: number }>;
  truncated: boolean;
}

describe.skipIf(!hasDatabase)("runtime telemetry (integration)", () => {
  let app: TestApp;
  let admin: Client;
  const NOW = Date.now();
  const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString();

  async function span(
    run: string,
    step: string | null,
    attempt: number,
    id: string,
    parent: string | null,
    name: string,
    minutesAgo: number,
    durationMs: number,
    attributes: Record<string, string | number | boolean>,
    extra: { agent?: string; model?: string; project?: string; status?: "ok" | "error" } = {},
  ): Promise<void> {
    await app.db.query(
      `insert into monitoring.telemetry_span (job_run_id, step_run_id, project_id, agent, provider, model, attempt, span_id, parent_span_id, name, started_at, duration_ms, status, attributes)
       values ($1, $2, $3, $4, 'anthropic-main', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [run, step, extra.project ?? "alpha", extra.agent ?? "legacy-analyst@1.1.0", extra.model ?? "claude-sonnet", attempt, id, parent, name, at(minutesAgo), durationMs, extra.status ?? "ok", JSON.stringify(attributes)],
    );
  }

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.project (id, name) values ('alpha', 'Alpha'), ('beta', 'Beta')");
    for (const [id, project] of [["run-1", "alpha"], ["run-2", "alpha"], ["run-3", "beta"]] as const) {
      await app.db.query("insert into workflow.job_run (id, project_id, kind, name) values ($1, $2, 'stage', 'understand')", [id, project]);
    }
    // run-1, step s1: a job of two turns with a compaction, a codemode script (one nested read) and an MCP call.
    await span("run-1", "s1", 1, "s1", null, "kintsugi.job", 30, 9000, {
      turns: 2, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 1000, costUsd: 0.5, compactions: 1, contextPeakPercent: 81.5, outcome: "completed",
    });
    await span("run-1", "s1", 1, "s2", "s1", "kintsugi.turn", 29, 4000, { turn: 1, inputTokens: 600, outputTokens: 100 });
    await span("run-1", "s1", 1, "s3", "s2", "kintsugi.codemode", 29, 300, { tool: "codemode", nestedCalls: 1 });
    await span("run-1", "s1", 1, "s4", "s3", "kintsugi.tool", 29, 20, { tool: "read", nested: true });
    await span("run-1", "s1", 1, "s5", "s2", "kintsugi.mcp", 29, 800, { tool: "mcp__tracker__search", server: "tracker" }, { status: "error" });
    await span("run-1", "s1", 1, "s6", "s1", "kintsugi.compaction", 28, 2500, { reason: "threshold" });
    // run-2: a failed attempt that overflowed, then its retry; another agent and model.
    await span("run-2", "s1", 1, "s1", null, "kintsugi.job", 20, 5000, { turns: 1, inputTokens: 5000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.2, compactions: 0, outcome: "context-overflow" }, { agent: "business-rules-extractor@1.0.0", model: "gpt-x", status: "error" });
    await span("run-2", "s1", 1, "s2", "s1", "kintsugi.compaction", 19, 100, { reason: "overflow" }, { agent: "business-rules-extractor@1.0.0", model: "gpt-x", status: "error" });
    await span("run-2", "s1", 2, "s1", null, "kintsugi.job", 10, 3000, { turns: 1, inputTokens: 200, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 0, costUsd: 0.1, compactions: 0, outcome: "completed" }, { agent: "business-rules-extractor@1.0.0", model: "gpt-x" });
    await span("run-2", "s1", 2, "s2", "s1", "kintsugi.tool", 9, 10, { tool: "read" }, { agent: "business-rules-extractor@1.0.0", model: "gpt-x" });
    // run-3 belongs to another project, 40 days ago.
    await span("run-3", null, 1, "s1", null, "kintsugi.job", 40 * 24 * 60, 1000, { turns: 1, inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, compactions: 0, outcome: "completed" }, { project: "beta" });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("every route requires telemetry.view", async () => {
    const { client } = await memberClient(app, admin, "no-telemetry", ["user"]);
    for (const path of ["/monitoring/telemetry/summary", "/monitoring/telemetry/runs", "/monitoring/telemetry/runs/run-1/trace"]) {
      expect((await client.get(path)).status, path).toBe(403);
    }
    await subRole(admin, "telemetry-viewer", ["telemetry.view"]);
    const { client: allowed } = await memberClient(app, admin, "viewer", ["user", "telemetry-viewer"]);
    expect((await allowed.get("/monitoring/telemetry/summary")).status).toBe(200);
  });

  it("sums the root spans of the window and derives the cache hit rate", async () => {
    const response = await admin.get<Summary>("/monitoring/telemetry/summary?projectId=alpha");
    expect(response.status).toBe(200);
    const { totals, byAgent, byModel, daily, compactionReasons, tools } = response.body.data!;
    expect(totals).toMatchObject({
      jobs: 3,
      failedJobs: 1,
      overflowFailures: 1,
      turns: 4,
      inputTokens: 6200,
      outputTokens: 250,
      cacheReadTokens: 3800,
      cacheWriteTokens: 1000,
      compactions: 1,
      retries: 0,
      toolCalls: 4,
      toolErrors: 1,
      codemodeCalls: 1,
      mcpCalls: 1,
    });
    expect(totals["costUsd"]).toBeCloseTo(0.8);
    expect(totals["cacheHitRate"]).toBeCloseTo(3800 / (3800 + 6200 + 1000));
    expect(byAgent.map((row) => [row.key, row.jobs, row.failedJobs])).toEqual([
      ["legacy-analyst@1.1.0", 1, 0],
      ["business-rules-extractor@1.0.0", 2, 1],
    ]);
    expect(byModel.map((row) => row.key).sort()).toEqual(["anthropic-main/claude-sonnet", "anthropic-main/gpt-x"]);
    expect(daily.reduce((sum, day) => sum + day.jobs, 0)).toBe(3);
    expect(compactionReasons).toEqual(expect.arrayContaining([{ reason: "threshold", count: 1 }, { reason: "overflow", count: 1 }]));
    expect(tools.find((row) => row.tool === "read")).toMatchObject({ calls: 2, errors: 0 });
    expect(tools.find((row) => row.tool === "mcp__tracker__search")).toMatchObject({ calls: 1, errors: 1 });
    expect(totals["toolP95Ms"]).toBeGreaterThan(0);
  });

  it("filters by project, agent and window, and refuses a bad window", async () => {
    const other = await admin.get<Summary>("/monitoring/telemetry/summary?projectId=alpha&agent=business-rules-extractor");
    expect(other.body.data!.totals["jobs"]).toBe(2);
    const exact = await admin.get<Summary>("/monitoring/telemetry/summary?agent=legacy-analyst@1.1.0");
    expect(exact.body.data!.totals["jobs"]).toBe(1);
    const old = await admin.get<Summary>(`/monitoring/telemetry/summary?projectId=beta&from=${encodeURIComponent(at(41 * 24 * 60))}&to=${encodeURIComponent(at(39 * 24 * 60))}`);
    expect(old.body.data!.totals["jobs"]).toBe(1);
    const defaultWindow = await admin.get<Summary>("/monitoring/telemetry/summary?projectId=beta");
    expect(defaultWindow.body.data!.totals["jobs"]).toBe(0);
    expect(defaultWindow.body.data!.totals["cacheHitRate"]).toBeNull();
    expect((await admin.get(`/monitoring/telemetry/summary?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(60))}`)).status).toBe(400);
    expect((await admin.get(`/monitoring/telemetry/summary?from=${encodeURIComponent(at(100 * 24 * 60))}`)).status).toBe(400);
  });

  it("lists the attempts newest first with their usage, and filters by status", async () => {
    const all = await admin.get<Page<Run>>("/monitoring/telemetry/runs?projectId=alpha");
    expect(all.body.data!.total).toBe(3);
    expect(all.body.data!.items.map((run) => [run.runId, run.attempt, run.outcome])).toEqual([
      ["run-2", 2, "completed"],
      ["run-2", 1, "context-overflow"],
      ["run-1", 1, "completed"],
    ]);
    expect(all.body.data!.items[2]).toMatchObject({ stepRunId: "s1", inputTokens: 1000, cacheReadTokens: 3000, compactions: 1, contextPeakPercent: 81.5 });
    const one = await admin.get<Page<Run>>("/monitoring/telemetry/runs?runId=run-2");
    expect(one.body.data!.items.map((run) => [run.runId, run.attempt])).toEqual([["run-2", 2], ["run-2", 1]]);
    expect((await admin.get<Page<Run>>("/monitoring/telemetry/runs?runId=nope")).body.data!.total).toBe(0);
    const failed = await admin.get<Page<Run>>("/monitoring/telemetry/runs?projectId=alpha&status=error&limit=1");
    expect(failed.body.data).toMatchObject({ total: 1, limit: 1 });
    expect(failed.body.data!.items[0]).toMatchObject({ runId: "run-2", attempt: 1, status: "error" });
  });

  it("returns the spans of a run in start order, narrowed by step and attempt", async () => {
    const trace = await admin.get<Trace>("/monitoring/telemetry/runs/run-1/trace");
    expect(trace.status).toBe(200);
    expect(trace.body.data!.truncated).toBe(false);
    expect(trace.body.data!.spans.map((entry) => entry.name)).toEqual(["kintsugi.job", "kintsugi.turn", "kintsugi.codemode", "kintsugi.tool", "kintsugi.mcp", "kintsugi.compaction"]);
    const nested = trace.body.data!.spans.find((entry) => entry.spanId === "s4");
    expect(nested?.parentSpanId).toBe("s3");
    const second = await admin.get<Trace>("/monitoring/telemetry/runs/run-2/trace?step=s1&attempt=2");
    expect(second.body.data!.spans.map((entry) => entry.attempt)).toEqual([2, 2]);
    expect((await admin.get("/monitoring/telemetry/runs/nope/trace")).status).toBe(404);
  });
});
