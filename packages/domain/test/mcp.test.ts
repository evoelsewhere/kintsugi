import { describe, expect, it } from "vitest";
import { isMcpToolEntry, matchesToolPattern, mcpHeaderValueProblem, mcpServerOfEntry, mcpServersNamedBy, mcpToolEntry, mcpToolPrefix, MCP_SERVER_ID_PATTERN } from "../src/index.js";

describe("MCP server vocabulary", () => {
  it("names the tools of a server with its id, dashes written as underscores", () => {
    expect(mcpToolPrefix("tracker")).toBe("mcp__tracker__");
    expect(mcpToolPrefix("dev-radius")).toBe("mcp__dev_radius__");
    expect(mcpToolEntry("dev-radius")).toBe("mcp__dev_radius__*");
  });

  it("recognises the entries of a tools list that name MCP tools and the server behind them", () => {
    expect(isMcpToolEntry("mcp__tracker__*")).toBe(true);
    expect(isMcpToolEntry("mcp__dev_radius__search")).toBe(true);
    for (const other of ["read", "mcp__", "mcp__tracker", "mcp__Tracker__x", "mcp__tracker__"]) expect(isMcpToolEntry(other)).toBe(false);
    expect(mcpServerOfEntry("mcp__dev_radius__search")).toBe("dev-radius");
    expect(mcpServerOfEntry("read")).toBeUndefined();
  });

  it("lists the distinct servers an agent names", () => {
    expect(mcpServersNamedBy(["read", "mcp__tracker__*", "mcp__tracker__search", "mcp__wiki__get", "git"])).toEqual(["tracker", "wiki"]);
    expect(mcpServersNamedBy(["read"])).toEqual([]);
  });

  it("accepts the ids the API accepts", () => {
    for (const ok of ["tracker", "dev-radius", "a1"]) expect(MCP_SERVER_ID_PATTERN.test(ok)).toBe(true);
    for (const bad of ["Tracker", "1tracker", "my_server", "", "x".repeat(42)]) expect(MCP_SERVER_ID_PATTERN.test(bad)).toBe(false);
  });

  it("refuses header values pi would interpret", () => {
    expect(mcpHeaderValueProblem("Bearer abc")).toBeUndefined();
    expect(mcpHeaderValueProblem("!cat /etc/passwd")).toMatch(/`!`/);
    expect(mcpHeaderValueProblem("x ${HOME}")).toMatch(/\$\{/);
    expect(mcpHeaderValueProblem("a\nb")).toMatch(/line break/);
  });

  it("matches tool patterns where * stands for any characters", () => {
    expect(matchesToolPattern("search_*", "search_issues")).toBe(true);
    expect(matchesToolPattern("search_*", "create_issue")).toBe(false);
    expect(matchesToolPattern("get", "get")).toBe(true);
    expect(matchesToolPattern("get", "get_all")).toBe(false);
    expect(matchesToolPattern("a.b", "axb")).toBe(false);
  });
});
