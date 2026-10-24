// The OTLP export of job spans (ADR-0074) against a fake backend and a fake pool: the shape of the body, that nothing is
// sent while export is off, and that a failing backend never throws.

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "@kintsugi/secrets";
import type { SpanRecord } from "../src/jobs/model.js";

type Json = Record<string, unknown>;
interface Body {
  resourceSpans: Array<{ resource: { attributes: unknown[] }; scopeSpans: Array<{ spans: Json[] }> }>;
}
import { createSpanExporter, otlpBody, pgExportTarget } from "../src/telemetry-export.js";

const record = (overrides: Partial<SpanRecord> = {}): SpanRecord => ({
  runId: "run-1",
  projectId: "p1",
  agent: "analyst@1",
  provider: "prov",
  model: "m",
  attempt: 1,
  span: { id: "s2", parentId: "s1", name: "kintsugi.turn", startedAt: "2026-10-24T10:00:00.000Z", durationMs: 1500, status: "ok", attributes: { "kintsugi.input_tokens": 120, "kintsugi.cost_usd": 0.5, "kintsugi.final": true, "kintsugi.reason": "stop" } },
  ...overrides,
});

describe("OTLP span export (ADR-0074)", () => {
  it("maps a span to the OTLP JSON shape with derived ids and nanosecond times", () => {
    const body = otlpBody("kintsugi-runtime", [record(), record({ span: { id: "s1", name: "kintsugi.job", startedAt: "2026-10-24T10:00:00.000Z", durationMs: 2000, status: "error", error: "boom", attributes: {} } })]) as Body;
    const spans = body.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(body.resourceSpans[0]!.resource.attributes).toEqual([{ key: "service.name", value: { stringValue: "kintsugi-runtime" } }]);
    const [turn, job] = spans as [Json, Json];
    expect(turn["traceId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(turn["traceId"]).toBe(job["traceId"]);
    expect(turn["spanId"]).toMatch(/^[0-9a-f]{16}$/);
    expect(turn["parentSpanId"]).toBe(job["spanId"]);
    expect(job["parentSpanId"]).toBeUndefined();
    expect(turn["startTimeUnixNano"]).toBe("1792836000000000000");
    expect(turn["endTimeUnixNano"]).toBe("1792836001500000000");
    expect(turn["status"]).toEqual({ code: 1 });
    expect(job["status"]).toEqual({ code: 2, message: "boom" });
    const byKey = Object.fromEntries((turn["attributes"] as Array<{ key: string; value: unknown }>).map((entry) => [entry.key, entry.value]));
    expect(byKey["kintsugi.input_tokens"]).toEqual({ intValue: "120" });
    expect(byKey["kintsugi.cost_usd"]).toEqual({ doubleValue: 0.5 });
    expect(byKey["kintsugi.final"]).toEqual({ boolValue: true });
    expect(byKey["kintsugi.model"]).toEqual({ stringValue: "m" });
  });

  it("gives the same ids for the same span and different ids for another attempt", () => {
    const a = otlpBody("s", [record()]) as Body;
    const b = otlpBody("s", [record()]) as Body;
    const c = otlpBody("s", [record({ attempt: 2 })]) as Body;
    const id = (body: Body): unknown => body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!["spanId"];
    expect(id(a)).toBe(id(b));
    expect(id(a)).not.toBe(id(c));
  });

  it("sends nothing while export is off, and posts to /v1/traces with the headers once on", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    let target = { enabled: false, endpoint: "https://c:4318", serviceName: "svc", headers: { Authorization: "Basic abc" } };
    const exporter = createSpanExporter({ target: async () => target, fetch: send });
    await exporter.export([record()]);
    expect(calls).toHaveLength(0);
    target = { ...target, enabled: true };
    await exporter.export([record()]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://c:4318/v1/traces");
    expect(calls[0]!.init.headers).toEqual({ Authorization: "Basic abc", "content-type": "application/json" });
  });

  it("never throws when the backend fails or answers with an error, and logs at most once a minute", async () => {
    const logs: string[] = [];
    const down = createSpanExporter({ target: async () => ({ enabled: true, endpoint: "https://c", serviceName: "s", headers: {} }), fetch: (async () => { throw new Error("connect refused"); }) as unknown as typeof fetch, log: (line) => logs.push(line) });
    await expect(down.export([record()])).resolves.toBeUndefined();
    await down.export([record()]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("connect refused");
    const refused = createSpanExporter({ target: async () => ({ enabled: true, endpoint: "https://c", serviceName: "s", headers: {} }), fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch, log: (line) => logs.push(line) });
    await refused.export([record()]);
    expect(logs[1]).toContain("401");
  });

  it("reads the setting and decrypts its headers; a missing row is off, an unreadable database keeps the last target", async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    const state: { row?: unknown; fail: boolean } = { fail: false };
    const pool = {
      query: async () => {
        if (state.fail) throw new Error("db down");
        return { rows: state.row === undefined ? [] : [{ value: state.row }] };
      },
    };
    const target = pgExportTarget(pool as never, 0);
    expect((await target()).enabled).toBe(false);
    state.row = { enabled: true, endpoint: "https://c:4318", serviceName: "svc", headers: encryptSecret(JSON.stringify({ Authorization: "Basic abc" })), headerNames: ["Authorization"] };
    expect(await target()).toEqual({ enabled: true, endpoint: "https://c:4318", serviceName: "svc", headers: { Authorization: "Basic abc" } });
    state.fail = true;
    expect((await target()).enabled).toBe(true);
  });
});
