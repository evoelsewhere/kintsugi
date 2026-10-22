// MCP servers of the Kintsugi Runtime (ADR-0047): the vocabulary shared by the API (which stores
// them), the agent definitions (which name them in `tools`) and the runtime (which connects them).
//
// An admin registers a server under an id (`tracker`). Its tools reach the model as
// `mcp__<id>__<tool>`, with every non-alphanumeric character of the id written as `_`. An agent opts
// in by naming the server in its `tools`: `mcp__tracker__*` for all of its tools, or
// `mcp__tracker__search` for one. MCP is never part of an agent's default tools.

/** The id of an MCP server: lowercase, starts with a letter, at most 41 characters. */
export const MCP_SERVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

/** What every tool of the server `id` is named in front of: `mcp__my_server__`. */
export function mcpToolPrefix(id: string): string {
  return `mcp__${id.replace(/[^A-Za-z0-9]/g, "_")}__`;
}

/** The tools entry that names every tool of a server. */
export function mcpToolEntry(id: string): string {
  return `${mcpToolPrefix(id)}*`;
}

/** An entry of an agent's `tools` that names MCP tools: `mcp__<server>__<tool or *>`. */
export const MCP_TOOL_ENTRY_PATTERN = /^mcp__[a-z][a-z0-9_]*__[A-Za-z0-9_*]+$/;

export function isMcpToolEntry(entry: string): boolean {
  return MCP_TOOL_ENTRY_PATTERN.test(entry);
}

/** The server a `tools` entry names (`mcp__my_server__*` → `my-server`); undefined for any other entry. */
export function mcpServerOfEntry(entry: string): string | undefined {
  if (!isMcpToolEntry(entry)) return undefined;
  const namespace = entry.slice("mcp__".length, entry.indexOf("__", "mcp__".length));
  return namespace.replace(/_/g, "-");
}

/** The distinct servers an agent's `tools` name, in order of appearance. */
export function mcpServersNamedBy(tools: readonly string[]): string[] {
  const ids: string[] = [];
  for (const entry of tools) {
    const id = mcpServerOfEntry(entry);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Header values pi would interpret: `!command` runs a command and `${NAME}` reads the environment of the
 * process. A header an admin typed is data, so neither is accepted (a value with one would execute inside a job).
 */
export function mcpHeaderValueProblem(value: string): string | undefined {
  if (value.startsWith("!")) return "a header value cannot start with `!`";
  if (value.includes("${")) return "a header value cannot contain `${`";
  if (/[\r\n]/.test(value)) return "a header value cannot contain a line break";
  return undefined;
}

/** Whether a tool name (as pi names it, without the server prefix) matches an `allowedTools` pattern: `*` matches any characters. */
export function matchesToolPattern(pattern: string, tool: string): boolean {
  const expression = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return expression.test(tool);
}
