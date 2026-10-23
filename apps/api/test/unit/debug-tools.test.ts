import { describe, expect, it } from "vitest";
import { basicCredentials } from "../../src/modules/system/debug/application/debug-access.js";
import { checkStatement, sinceOf } from "../../src/modules/system/debug/application/debug-tools.js";
import { debugMcpEnabled } from "../../src/common/config/env.js";
import { clip } from "../../src/modules/system/debug/infrastructure/pg-debug.store.js";

describe("debug MCP helpers (ADR-0056)", () => {
  it("is on only for 1 or true", () => {
    expect(debugMcpEnabled({})).toBe(false);
    expect(debugMcpEnabled({ KINTSUGI_DEBUG_MCP: "" })).toBe(false);
    expect(debugMcpEnabled({ KINTSUGI_DEBUG_MCP: "0" })).toBe(false);
    expect(debugMcpEnabled({ KINTSUGI_DEBUG_MCP: "yes" })).toBe(false);
    expect(debugMcpEnabled({ KINTSUGI_DEBUG_MCP: "1" })).toBe(true);
    expect(debugMcpEnabled({ KINTSUGI_DEBUG_MCP: " TRUE " })).toBe(true);
  });

  it("reads Basic credentials, a password with a colon included, and nothing else", () => {
    const header = (text: string): string => `Basic ${Buffer.from(text).toString("base64")}`;
    expect(basicCredentials(header("admin:pa:ss"))).toEqual({ username: "admin", password: "pa:ss" });
    expect(basicCredentials(header(":pw"))).toBeUndefined();
    expect(basicCredentials(header("nocolon"))).toBeUndefined();
    expect(basicCredentials("Bearer abc")).toBeUndefined();
    expect(basicCredentials(undefined)).toBeUndefined();
  });

  it("reads a time as minutes, hours or days before now, or as a date", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(sinceOf("15m", now).toISOString()).toBe("2026-10-22T11:45:00.000Z");
    expect(sinceOf("2h", now).toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(sinceOf("1d", now).toISOString()).toBe("2026-10-21T12:00:00.000Z");
    expect(sinceOf("2026-10-20T08:00:00Z", now).toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(() => sinceOf("soon", now)).toThrow(/is not a time/);
  });

  it("lets one select or with through and nothing that changes, explains or chains", () => {
    expect(checkStatement("  select 1; ")).toBe("select 1");
    expect(checkStatement("WITH a AS (select 1) select * from a")).toContain("WITH");
    expect(checkStatement("select 'update me' as note")).toBe("select 'update me' as note");
    for (const bad of ["", "update t set a = 1", "select 1; select 2", "delete from t", "explain select 1", "select * from t for update; drop table t", "with a as (insert into t values (1) returning *) select * from a", "show all"]) {
      expect(() => checkStatement(bad), bad).toThrow();
    }
  });

  it("cuts long strings in an answer and keeps the structure", () => {
    expect(clip({ a: "x".repeat(30), b: ["y".repeat(5), 1, null], c: { d: "z".repeat(12) } }, 10)).toEqual({
      a: "xxxxxxxxxx… [30 characters]",
      b: ["yyyyy", 1, null],
      c: { d: "zzzzzzzzzz… [12 characters]" },
    });
  });
});
