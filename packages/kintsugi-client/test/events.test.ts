import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@kintsugi/harness-sdk";
import { createCodingAgentWorkflowClient } from "../src/client.js";

const query = { projectId: "shop", unitId: "web/core/invoice" };
const event = (id: string): TaskEvent => ({ schemaVersion: "1", ...query, id, kind: "review.completed", occurredAt: "2026-10-21T00:00:00Z", metadata: { reviewId: "review_1" } });
const frame = (id: string) => `event: task-event\nid: ${id}\ndata: ${JSON.stringify(event(id))}\n\n`;
const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
async function collect(events: AsyncIterable<TaskEvent>): Promise<TaskEvent[]> { const values: TaskEvent[] = []; for await (const value of events) values.push(value); return values; }
function client(fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof createCodingAgentWorkflowClient>[0]> = {}) {
  return createCodingAgentWorkflowClient({ baseUrl: "https://kintsugi.example/base", tokenProvider: () => "TEST-private-token", fetch, sleep: async () => undefined, ...extra });
}

describe("task SSE transport", () => {
  it("decodes fragmented UTF-8/CRLF, multiline data and heartbeats with exact scope and resume headers", async () => {
    const expected = { ...event("evt_2"), metadata: { message: "Révision" } };
    const encoded = new TextEncoder().encode(`: heartbeat\r\nevent: task-event\r\nid: evt_2\r\ndata: ${JSON.stringify(expected).slice(0, -1)}\r\ndata: }\r\n\r\n`);
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); },
    }), { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
    expect(await collect(client(fetch).watchTask({ ...query, afterEventId: "evt_1", limit: 1 }, new AbortController().signal))).toEqual([expected]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://kintsugi.example/base/api/member/v1/task-events?projectId=shop&unitId=web%2Fcore%2Finvoice&afterEventId=evt_1&limit=1");
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("last-event-id")).toBe("evt_1");
    expect(new Headers(init?.headers).get("accept")).toBe("text/event-stream");
    expect(init?.redirect).toBe("manual");
  });

  it("reconnects after EOF using the last delivered id, remaining limit and refreshed credentials", async () => {
    let token = "first-token";
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) { token = "second-token"; return sse(frame("evt_1")); }
      return sse(frame("evt_2"));
    });
    expect(await collect(client(fetch, { tokenProvider: () => token }).watchTask({ ...query, limit: 2 }, new AbortController().signal))).toEqual([event("evt_1"), event("evt_2")]);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("last-event-id")).toBe("evt_1");
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer second-token");
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get("limit")).toBe("1");
  });

  it.each([
    [409, "MEMBER_EVENT_CURSOR_EXPIRED"], [401, "UNAUTHENTICATED"], [403, "FORBIDDEN"],
  ] as const)("stops on HTTP %s without silently resetting the cursor", async (status, code) => {
    const fetch = vi.fn(async () => Response.json({ success: false, message: "Cannot resume", details: { code } }, { status }));
    await expect(collect(client(fetch).watchTask({ ...query, afterEventId: "expired" }, new AbortController().signal))).rejects.toMatchObject({ status, code });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("surfaces terminal error frames with credential redaction", async () => {
    await expect(collect(client(async () => sse('event: error\ndata: {"code":"FORBIDDEN","message":"TEST-private-token revoked"}\n\n')).watchTask(query, new AbortController().signal))).rejects.toMatchObject({ code: "FORBIDDEN", message: "[redacted] revoked" });
  });

  it.each([
    'event: task-event\nid: wrong\ndata: ' + JSON.stringify(event("evt_1")) + '\n\n',
    'event: task-event\nid: evt_1\ndata: {}\n\n',
    'event: task-event\nid: evt_1\ndata: invalid-json\n\n',
    'event: task-event\nid: evt_1\ndata: ' + JSON.stringify({ ...event("evt_1"), projectId: "other" }) + '\n\n',
  ])("rejects malformed/mis-scoped events", async (body) => {
    await expect(collect(client(async () => sse(body)).watchTask(query, new AbortController().signal))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("cancels an idle reader and ignores the ordinary request timeout", async () => {
    const watch = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start() { ready(); }, cancel }), { headers: { "content-type": "text/event-stream" } }));
    const pending = collect(client(fetch, { signal: AbortSignal.abort() }).watchTask(query, watch.signal));
    await started;
    watch.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("closes the reader when a consumer stops early", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame("evt_1"))); }, cancel }), { headers: { "content-type": "text/event-stream" } });
    for await (const value of client(async () => response).watchTask(query, new AbortController().signal)) { expect(value.id).toBe("evt_1"); break; }
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("omits an unspecified event limit and rejects invalid limits before requesting", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL) => sse(frame("evt_1")));
    for await (const _value of client(fetch).watchTask(query, new AbortController().signal)) break;
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.has("limit")).toBe(false);
    for (const limit of [0, 1001, 1.5]) await expect(collect(client(fetch).watchTask({ ...query, limit }, new AbortController().signal))).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("resumes an interrupted real TCP stream without losing the earlier event", async () => {
    let connections = 0;
    let disconnect = () => undefined;
    const server = createServer((_request, response) => {
      connections += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (connections === 1) { response.write(frame("evt_1")); disconnect = () => { response.destroy(); }; }
      else { expect(_request.headers["last-event-id"]).toBe("evt_1"); response.end(frame("evt_2")); }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No port");
      const access = client(globalThis.fetch, { baseUrl: `http://127.0.0.1:${address.port}` });
      const values: TaskEvent[] = [];
      for await (const value of access.watchTask({ ...query, limit: 2 }, new AbortController().signal)) { values.push(value); if (values.length === 1) disconnect(); }
      expect(values).toEqual([event("evt_1"), event("evt_2")]);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

describe("stream recovery boundaries", () => {
  it("discards an interrupted partial frame and resumes after the earlier complete event", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => fetch.mock.calls.length === 1
      ? sse(frame("evt_1") + 'event: task-event\nid: evt_2\ndata: {"schemaVersion":')
      : sse(frame("evt_2")));
    expect(await collect(client(fetch).watchTask({ ...query, limit: 2 }, new AbortController().signal))).toEqual([event("evt_1"), event("evt_2")]);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("last-event-id")).toBe("evt_1");
  });

  it("bounds failed reconnects and returns the last safely delivered resume id", async () => {
    const fetch = vi.fn(async () => sse(frame("evt_1")));
    const values: TaskEvent[] = [];
    const run = async () => { for await (const value of client(fetch, { maxRetries: 1 }).watchTask(query, new AbortController().signal)) values.push(value); };
    await expect(run()).rejects.toMatchObject({ code: "NETWORK_ERROR", details: { afterEventId: "evt_1" } });
    expect(values).toEqual([event("evt_1")]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors retry-after and never forwards credentials to a redirect", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => fetch.mock.calls.length === 1
      ? Response.json({ success: false, message: "busy" }, { status: 429, headers: { "retry-after": "2" } })
      : sse(frame("evt_1")));
    expect(await collect(client(fetch, { sleep }).watchTask({ ...query, limit: 1 }, new AbortController().signal))).toEqual([event("evt_1")]);
    expect(sleep).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }));
    await expect(collect(client(redirect).watchTask(query, new AbortController().signal))).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
    expect(redirect).toHaveBeenCalledOnce();
  });

  it("rejects non-SSE responses, oversized frames and credential-bearing events", async () => {
    for (const response of [Response.json(event("evt_1")), sse('data: ' + "x".repeat(1024 * 1024) + '\n\n'),
      sse('event: task-event\nid: evt_1\ndata: ' + JSON.stringify({ ...event("evt_1"), metadata: { secret: "TEST-private-token" } }) + '\n\n')]) {
      await expect(collect(client(async () => response).watchTask(query, new AbortController().signal))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
});
