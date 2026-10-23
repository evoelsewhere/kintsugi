// A minimal MCP server over Streamable HTTP, JSON replies only (ADR-0056): `initialize`, `ping`, `tools/list` and
// `tools/call`. No sessions, no streaming, no server-initiated messages. Pure: the tools and the caller come in.

import { z } from "zod";

export interface McpTool<Context> {
  name: string;
  description: string;
  input: z.ZodObject;
  run(args: never, context: Context): Promise<unknown>;
}

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

export type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null; result: unknown } | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** The longest text one tool answers with; the rest is cut, with the size said. */
export const MAX_ANSWER_CHARS = 60_000;

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export interface ServerInfo {
  name: string;
  version: string;
  instructions: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON Schema of a tool's input, without the `$schema` marker. */
export function inputSchema(input: z.ZodObject): Record<string, unknown> {
  const { $schema: _marker, ...schema } = z.toJSONSchema(input, { io: "input" }) as Record<string, unknown>;
  return schema;
}

export function answer(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return { content: [{ type: "text", text: text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}\n… [cut: ${text.length} characters; narrow the question]` : text }] };
}

const failure = (message: string): { content: Array<{ type: "text"; text: string }>; isError: true } => ({ content: [{ type: "text", text: message }], isError: true });

/** Handles one message. A notification (no id) gets no answer. */
export async function handleMessage<Context>(
  message: unknown,
  tools: ReadonlyMap<string, McpTool<Context>>,
  info: ServerInfo,
  context: Context,
  onCall?: (tool: string, args: unknown) => Promise<void>,
): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Not a JSON-RPC 2.0 request" } };
  }
  const request = message as JsonRpcRequest;
  const method = request.method as string;
  const hasId = request.id !== undefined;
  const id = request.id ?? null;
  const reply = (result: unknown): JsonRpcResponse | undefined => (hasId ? { jsonrpc: "2.0", id, result } : undefined);
  const error = (code: number, text: string): JsonRpcResponse | undefined => (hasId ? { jsonrpc: "2.0", id, error: { code, message: text } } : undefined);

  switch (method) {
    case "initialize": {
      const asked = isRecord(request.params) && typeof request.params["protocolVersion"] === "string" ? request.params["protocolVersion"] : undefined;
      return reply({
        protocolVersion: asked !== undefined && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: info.name, version: info.version },
        instructions: info.instructions,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: inputSchema(tool.input) })) });
    case "tools/call": {
      const params = isRecord(request.params) ? request.params : {};
      const tool = typeof params["name"] === "string" ? tools.get(params["name"]) : undefined;
      if (tool === undefined) return error(INVALID_PARAMS, `Unknown tool "${String(params["name"])}"`);
      const parsed = tool.input.safeParse(params["arguments"] ?? {});
      if (!parsed.success) return reply(failure(`Invalid arguments for ${tool.name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`).join("; ")}`));
      try {
        await onCall?.(tool.name, parsed.data);
        return reply(answer(await tool.run(parsed.data as never, context)));
      } catch (caught) {
        return reply(failure(`${tool.name} failed: ${caught instanceof Error ? caught.message : String(caught)}`));
      }
    }
    default:
      // Notifications (initialized, cancelled, …) carry no id and need no answer.
      return hasId ? error(METHOD_NOT_FOUND, `Method not found: ${method}`) : undefined;
  }
}
