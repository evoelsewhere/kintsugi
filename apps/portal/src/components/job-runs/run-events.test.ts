import { describe, expect, it, vi } from "vitest";
import type { JobRunEvent, JobRunView } from "@/lib/api/job-runs";
// run-events imports the API client, which reads localStorage when it loads.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
});

import { describeGroup, feedGroups, humanize, isProblem, statsByStep, stuckReason, tidyPath, timelineOf } from "./run-events";

let counter = 0;
const tool = (message: string, over: Partial<JobRunEvent> & { tool?: string; decision?: string } = {}): JobRunEvent => ({
  id: `e${++counter}`,
  at: new Date(1_700_000_000_000 + counter * 1000).toISOString(),
  kind: "tool",
  message,
  ...(over.stepRunId === undefined ? {} : { stepRunId: over.stepRunId }),
  data: { tool: over.tool ?? message.split(" ")[0], decision: over.decision ?? "allowed" },
});

describe("feed of tool calls", () => {
  it("folds consecutive calls of one tool by one step into a group that names their folder", () => {
    const groups = feedGroups([tool("read as-is/app/cbl/A.cbl"), tool("read as-is/app/cbl/B.cbl"), tool("read as-is/app/cbl/C.cbl")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tool: "read", count: 3, target: "app/cbl/" });
    expect(describeGroup(groups[0]!)).toBe("Read 3 files in app/cbl/");
  });

  it("starts a new group when the tool changes, and keeps the steps apart", () => {
    const groups = feedGroups([tool("read a.txt", { stepRunId: "s1" }), tool("grep a.txt", { stepRunId: "s1" }), tool("read b.txt", { stepRunId: "s2" })]);
    expect(groups.map((group) => [group.tool, group.stepRunId])).toEqual([["read", "s1"], ["grep", "s1"], ["read", "s2"]]);
  });

  it("tells one call by its target and a blocked call as blocked", () => {
    const [read] = feedGroups([tool("read to-be/src/Main.java")]);
    expect(describeGroup(read!)).toBe("Read src/Main.java");
    const [blocked] = feedGroups([tool("blocked: write /etc/passwd", { tool: "write", decision: "blocked" })]);
    expect(blocked).toMatchObject({ blocked: true, target: "/etc/passwd" });
    expect(describeGroup(blocked!)).toBe("Blocked 1 call (write) /etc/passwd");
  });

  it("names searches, commands and unknown tools", () => {
    expect(describeGroup({ key: "k", stepRunId: undefined, tool: "grep", count: 4, target: "app", at: "", blocked: false })).toBe("Ran 4 searches in app");
    expect(describeGroup({ key: "k", stepRunId: undefined, tool: "shell", count: 2, target: "", at: "", blocked: false })).toBe("Ran 2 commands");
    expect(describeGroup({ key: "k", stepRunId: undefined, tool: "mcp", count: 2, target: "jira", at: "", blocked: false })).toBe("mcp ×2 jira");
  });

  it("ignores events that are not tool calls", () => {
    expect(feedGroups([{ id: "x", at: "2026-01-01T00:00:00Z", kind: "log", message: "hello", data: {} }])).toEqual([]);
  });
});

describe("words and problems", () => {
  it("humanizes names and tidies paths", () => {
    expect(humanize("business-rules_extractor")).toBe("Business rules extractor");
    expect(tidyPath("[redacted]/as-is/app/x")).toBe("app/x");
  });

  it("calls a blocked call, a failed step and a stalled log a problem", () => {
    expect(isProblem(tool("write x", { decision: "blocked" }))).toBe(true);
    expect(isProblem({ id: "a", at: "", kind: "step.finished", message: "", data: { status: "failed" } })).toBe(true);
    expect(isProblem({ id: "b", at: "", kind: "log", message: "agent stalled", data: {} })).toBe(true);
    expect(isProblem(tool("read x"))).toBe(false);
  });
});

const step = (id: string, status: JobRunView["status"], startedAt?: string, finishedAt?: string): JobRunView => ({ id, projectId: "p", kind: "agent", name: id, status, attempt: 1, restrictedRecords: 0, createdAt: "2026-01-01T00:00:00Z", ...(startedAt === undefined ? {} : { startedAt }), ...(finishedAt === undefined ? {} : { finishedAt }) });

describe("timeline of steps", () => {
  it("lays parallel steps on one axis, and runs an unfinished step up to now", () => {
    const t = (seconds: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
    const { rows, totalMs, started } = timelineOf([step("a", "succeeded", t(0), t(60)), step("b", "succeeded", t(30), t(90)), step("c", "running", t(60)), step("d", "queued")], Date.UTC(2026, 0, 1, 0, 2, 0));
    expect(started).toBe(3);
    expect(totalMs).toBe(120_000);
    expect(rows[0]).toMatchObject({ offsetPct: 0, widthPct: 50, durationMs: 60_000 });
    expect(rows[1]).toMatchObject({ offsetPct: 25, widthPct: 50 });
    expect(rows[2]).toMatchObject({ offsetPct: 50, widthPct: 50 });
    expect(rows[3]?.offsetPct).toBeUndefined();
  });

  it("has no axis while nothing has started", () => {
    expect(timelineOf([step("a", "queued")], 0)).toMatchObject({ totalMs: 0, started: 0 });
  });
});

describe("a step that looks stuck", () => {
  const at = (minute: number): string => new Date(Date.UTC(2026, 9, 31, 7, minute)).toISOString();
  const call = (minute: number, message = "glob in/**/topology.py"): JobRunEvent => ({ id: `t${minute}`, at: at(minute), kind: "tool", message, stepRunId: "s1", data: { tool: "glob", decision: "allowed" } });
  const turn = (minute: number, n: number): JobRunEvent => ({ id: `m${minute}`, at: at(minute), kind: "log", message: `model working: turn ${n}`, stepRunId: "s1", data: { turn: n, thinkingChars: 10, toolArgsChars: 0, textChars: 0 } });

  it("is flagged when its last ten tool calls are the same call", () => {
    const events = Array.from({ length: 10 }, (_, minute) => call(minute));
    expect(stuckReason(statsByStep(events).get("s1"), Date.parse(at(10)))).toMatch(/same call 10 times.*topology\.py/);
    expect(stuckReason(statsByStep([...events, call(11, "read in/a.md")]).get("s1"), Date.parse(at(12)))).toBeUndefined();
    expect(stuckReason(statsByStep(events.slice(1)).get("s1"), Date.parse(at(10)))).toBeUndefined();
  });

  it("is flagged when the model has been in one turn for more than five minutes without a tool call", () => {
    const events = [call(0, "read a.md"), turn(1, 7), turn(3, 7), turn(5, 7)];
    expect(stuckReason(statsByStep(events).get("s1"), Date.parse(at(5)))).toBeUndefined();
    expect(stuckReason(statsByStep(events).get("s1"), Date.parse(at(7)))).toBe("In turn 7 for 6 minutes without calling a tool");
    // A tool call in the turn, or the next turn, clears it.
    expect(stuckReason(statsByStep([...events, call(6, "read b.md")]).get("s1"), Date.parse(at(9)))).toBeUndefined();
    expect(stuckReason(statsByStep([...events, turn(6, 8)]).get("s1"), Date.parse(at(9)))).toBeUndefined();
  });

  it("is never flagged once it finished", () => {
    const events = [...Array.from({ length: 10 }, (_, minute) => call(minute)), { id: "f", at: at(10), kind: "step.finished" as const, message: "agent x failed", stepRunId: "s1", data: { status: "failed" } }];
    expect(stuckReason(statsByStep(events).get("s1"), Date.parse(at(11)))).toBeUndefined();
  });
});
