// The real thing, end to end in a child process under Node's permission model: an agent job whose
// model (a local OpenAI-compatible server) answers with a codemode script. It proves what unit tests
// cannot: the child may start the worker thread and load the QuickJS sandbox, the script reaches the
// read tool through the kernel's path guard, a write is refused, and only the script's output comes
// back to the model (ADR-0047, ADR-0029).

import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createChildAgentRuntime } from "@kintsugi/runtime/launcher";
import type { AgentDefinition, JobEvent, JobSpec } from "@kintsugi/runtime-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = [
  'const names = await tools.ls({ path: "." });',
  'const body = await tools.read({ path: "notes.txt" });',
  "text(`files: ${JSON.stringify(names)}; first line: ${body.split(String.fromCharCode(10))[0]}`);",
  'try { await tools.write({ path: "x.md", content: "x" }); text("WRITE ALLOWED"); } catch (error) { text("write refused"); }',
].join("\n");

describe("a codemode job in a child process", () => {
  let root: string;
  let server: Server;
  const requests: Array<{ messages: Array<{ role: string; content?: unknown }> }> = [];

  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "kintsugi-codemode-e2e-"));
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (part) => (body += part));
      request.on("end", () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content?: unknown }> };
        requests.push(parsed);
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (parsed.messages.some((message) => message.role === "tool")) {
          response.write(chunk({ role: "assistant", content: "all done" }, null));
          response.write(chunk({}, "stop"));
        } else {
          const call = { index: 0, id: "call_1", type: "function", function: { name: "codemode", arguments: JSON.stringify({ code: SCRIPT }) } };
          response.write(chunk({ role: "assistant", tool_calls: [call] }, null));
          response.write(chunk({}, "tool_calls"));
        }
        response.write("data: [DONE]\n\n");
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("runs the script in the worker, shows the model only its output, and refuses the write", async () => {
    const job = join(root, "job");
    for (const dir of ["src", "in", "out", "tmp"]) mkdirSync(join(job, dir), { recursive: true });
    writeFileSync(join(job, "src", "notes.txt"), "first line of the notes\nsecond line\n");
    const agent: AgentDefinition = { id: "scripted", version: "1.0.0", instructions: "Use codemode.", tools: ["read", "ls", "write", "codemode"] };
    const spec: JobSpec = {
      agent,
      task: "Summarise the notes.",
      model: { provider: "local", id: "m" },
      workspace: { readOnly: [join(job, "src")], outDir: join(job, "out") },
      limits: { timeoutSec: 90 },
    };
    const runtime = createChildAgentRuntime({
      mode: "pi",
      loadProvider: async () => ({
        config: { kind: "custom", id: "local", enabled: true, auth: { type: "none" }, api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, models: [{ id: "m" }] },
        credentials: { env: {}, secrets: {} },
      }),
    });
    const handle = await runtime.startJob(spec);
    const events: JobEvent[] = [];
    for await (const event of handle.events) events.push(event);
    const done = await handle.done;
    expect(done, done.type === "job.failed" ? done.error : "").toMatchObject({ type: "job.completed" });

    // What the model got back for the script is the script's output, not the file or the code.
    const result = String(requests[1]?.messages.find((message) => message.role === "tool")?.content);
    expect(result).toContain("first line of the notes");
    expect(result).toContain("write refused");
    expect(result).not.toContain("WRITE ALLOWED");
    expect(result).not.toContain("second line");

    const spans = events.flatMap((event) => (event.type === "span" ? [event.span] : []));
    const codemode = spans.find((span) => span.name === "kintsugi.codemode");
    expect(codemode).toBeDefined();
    expect(spans.filter((span) => span.attributes["nested"] === true).map((span) => span.attributes["tool"]).sort()).toEqual(expect.arrayContaining(["ls", "read"]));
  }, 120_000);
});
