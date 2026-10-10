// Harness tools (R2): read-only git access, web fetch and KB question-answering.
// Fixed in code (ADR-0014); registered as custom tools on every job session.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const run = promisify(execFile);

export function createGitReadTool(cwd: string): ToolDefinition {
  return defineTool({
    name: "git_read",
    label: "Git read",
    description:
      "Read-only git access on the checkout: op=log (recent commits), show (commit details), diff (working tree vs ref), blame (needs path). Never writes.",
    promptSnippet: "git_read — read-only git log / show / diff / blame",
    parameters: Type.Object({
      op: Type.Union([Type.Literal("log"), Type.Literal("show"), Type.Literal("diff"), Type.Literal("blame")]),
      ref: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    execute: async (_toolCallId, params) => {
      const limit = String(params.limit ?? 30);
      let args: string[];
      switch (params.op) {
        case "log":
          args = ["log", "--oneline", "-n", limit, params.ref ?? "HEAD"];
          break;
        case "show":
          args = ["show", "--stat", params.ref ?? "HEAD"];
          break;
        case "diff":
          args = ["diff", params.ref ?? "HEAD", ...(params.path === undefined ? [] : ["--", params.path])];
          break;
        case "blame":
          if (params.path === undefined) {
            return { details: undefined, content: [{ type: "text", text: "blame requires a path" }], isError: true };
          }
          args = ["blame", params.ref ?? "HEAD", "--", params.path];
          break;
      }
      try {
        const { stdout } = await run("git", ["-C", cwd, ...args], { maxBuffer: 1_000_000, timeout: 20_000 });
        return { details: undefined, content: [{ type: "text", text: stdout.slice(0, 60_000) || "(no output)" }] };
      } catch (error) {
        return {
          details: undefined,
          content: [{ type: "text", text: `git ${params.op} failed: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  });
}

export const webFetchTool = defineTool({
  name: "web_fetch",
  label: "Web fetch",
  description: "Fetch an http(s) URL and return its text (truncated). Domains are limited by the sandbox network policy.",
  promptSnippet: "web_fetch — fetch a URL (truncated text)",
  parameters: Type.Object({
    url: Type.String({ minLength: 4 }),
  }),
  execute: async (_toolCallId, params) => {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      return { details: undefined, content: [{ type: "text", text: "only http(s) URLs are allowed" }], isError: true };
    }
    try {
      const response = await fetch(params.url, {
        headers: { "user-agent": "kintsugi-runtime/0.0.0" },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      return {
        details: undefined,
        content: [{ type: "text", text: `HTTP ${response.status}\n${text.slice(0, 50_000)}` }],
        isError: !response.ok,
      };
    } catch (error) {
      return {
        details: undefined,
        content: [{ type: "text", text: `fetch failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
});

export const kbAskTool = defineTool({
  name: "kb_ask",
  label: "KB answer",
  description: "Ask a natural-language question over the project knowledge base; returns an answer with cited sources.",
  promptSnippet: "kb_ask — question answering over the knowledge base (with citations)",
  parameters: Type.Object({
    kb: Type.Union([Type.Literal("as-is"), Type.Literal("to-be")]),
    question: Type.String({ minLength: 3 }),
  }),
  execute: async (_toolCallId, params) => ({
    details: undefined,
    content: [
      {
        type: "text",
        text:
          `The knowledge base is not reachable from this job yet (kb=${params.kb}, question="${params.question}"). ` +
          "TODO: call the Kintsugi job gateway (services/harness-hub) when it lands.",
      },
    ],
  }),
});
