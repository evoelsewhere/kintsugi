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

  it("refuses the tables that hold secrets, spellings that hide a name and functions that run SQL text or read the server", () => {
    for (const bad of [
      "select * from core.app_user",
      "select count(*), bool_and(length(t::text) > 60) from core.app_user t",
      "select * from core.member_token",
      "select token_hash from core.member_connection_refresh_token",
      "select * from core.session",
      "select * from admin.git_secret",
      'select length(U&"pg\\005fread_file"(\'PG_VERSION\'))',
      'select * from core.U&"s\\0065ssion"',
      "select * from core.u&'x'",
      "select query_to_xml('select * from core.ses' || 'sion', true, false, '')",
      "select * from ts_stat('select to_tsvector(password_' || 'hash) from core.app_' || 'user')",
      "select ts_rewrite('a'::tsquery, 'select 1')",
      "select table_to_xml('core.app_' || 'user', true, false, '')",
      "select cursor_to_xml('c', 1, true, false, '')",
      "select schema_to_xml('core', true, false, '')",
      "select database_to_xml(true, false, '')",
      "select pg_read_binary_file('PG_VERSION')",
      "select * from pg_ls_dir('.')",
      "select pg_file_settings from pg_file_settings",
      "select * from pg_hba_file_rules",
      "select lo_get(1)",
      "select * from dblink('host=x', 'select 1') as t(a int)",
      "select most_common_vals from pg_stats where tablename = 'app_' || 'user'",
      "select * from pg_statistic",
      "select rolpassword from pg_authid",
      "select pg_terminate_backend(pid) from pg_stat_activity",
      "select set_config('role', 'x', true)",
      // Server state a read-only transaction and its rollback do not undo (never executed here: slots and locks are server-wide).
      "select pg_create_physical_replication_slot('x', true)",
      "select pg_create_logical_replication_slot('x', 'test_decoding')",
      "select pg_drop_replication_slot('x')",
      "select pg_replication_origin_create('x')",
      "select pg_advisory_lock(1)",
      "select pg_try_advisory_lock(1)",
      "select pg_advisory_xact_lock(1)",
      "select pg_notify('kintsugi_change', '{}')",
      "select pg_stat_reset()",
      "select pg_stat_reset_shared('bgwriter')",
      "select pg_switch_wal()",
      "select pg_promote()",
      "select pg_log_backend_memory_contexts(pg_backend_pid())",
    ]) {
      expect(() => checkStatement(bad), bad).toThrow();
    }
  });

  it("still runs ordinary diagnostic reads", () => {
    for (const good of [
      "select id, status, failure_reason from workflow.job_run where status = 'failed' order by created_at desc",
      "select id, name from admin.project",
      "select column_name, data_type from information_schema.columns where table_schema = 'workflow'",
      "with recent as (select * from workflow.job_run order by created_at desc limit 5) select id, status from recent",
      "select pid, state, wait_event from pg_stat_activity",
      "select count(*) from workflow.job_run",
      "select slot_name, active from pg_replication_slots",
      "select locktype, mode, granted from pg_locks",
      "select copied_from from admin.agent",
      "select sum((output_summary->'usage'->>'tokens')::int) from workflow.job_run",
    ]) {
      expect(checkStatement(good), good).toBe(good);
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
