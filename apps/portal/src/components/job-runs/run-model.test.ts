import { describe, expect, it, vi } from "vitest";
import type { JobRunEvent, JobRunView } from "@/lib/api/job-runs";
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
});
import { eventStepLabels, filterJobRuns, filterRunEvents, retryNotice, stepsForAttempt } from "./run-model";
import { timelineOf } from "./run-events";

const job = (id: string, createdAt: string, extra: Partial<JobRunView> = {}): JobRunView => ({
  id,
  createdAt,
  projectId: "project",
  kind: "stage",
  name: "understand",
  status: "succeeded",
  attempt: 1,
  restrictedRecords: 0,
  ...extra,
});
const event = (id: string, extra: Partial<JobRunEvent> = {}): JobRunEvent => ({
  id,
  at: "2026-10-25T00:00:00Z",
  kind: "tool",
  message: "read app/source.ts",
  attempt: 2,
  stepRunId: "s1",
  data: { tool: "read" },
  ...extra,
});
const label = (id: string | undefined): string => (id === "s1" ? "Legacy analyst" : "Run");

describe("console filtering", () => {
  it("defaults to useful activity without repeated model progress updates", () => {
    const tool = event("1");
    const progress = event("2", { kind: "log", data: { turn: 2 }, message: "model working" });
    const status = event("3", { kind: "step.finished", data: { status: "succeeded" } });
    expect(filterRunEvents([tool, progress, status], { filter: "activity", query: "", tool: "" }, label).map((entry) => entry.id)).toEqual([
      "1",
      "3",
    ]);
    expect(filterRunEvents([tool, progress, status], { filter: "all", query: "", tool: "" }, label)).toHaveLength(3);
  });
  it("isolates problems instead of adding them to ordinary tool events", () => {
    const read = event("1");
    const blocked = event("2", { data: { tool: "write", decision: "blocked" } });
    const failed = event("3", { kind: "step.finished", data: { status: "failed" } });
    expect(filterRunEvents([read, blocked, failed], { filter: "problems", query: "", tool: "" }, label).map((entry) => entry.id)).toEqual([
      "2",
      "3",
    ]);
  });
  it("combines attempt, descendants, tool and case-insensitive step search", () => {
    const events = [event("1", { attempt: 1 }), event("2"), event("3", { stepRunId: "other" }), event("4", { data: { tool: "write" } })];
    expect(
      filterRunEvents(events, { filter: "tool", query: "ANALYST", tool: "read", stepIds: new Set(["s1"]), attempt: 2 }, label).map(
        (entry) => entry.id,
      ),
    ).toEqual(["2"]);
  });
});
describe("attempt steps", () => {
  it("uses the parent attempt window, not each child's independent attempt counter", () => {
    const before = job("old", "2026-10-24T00:01:00Z", { status: "failed" });
    const current = job("new", "2026-10-25T00:01:00Z");
    const run = {
      ...job("root", "2026-10-24T00:00:00Z", {
        attempt: 2,
        startedAt: "2026-10-25T00:00:00Z",
        finishedAt: "2026-10-25T01:00:00Z",
        attempts: [{ n: 1, status: "failed" as const, startedAt: "2026-10-24T00:00:00Z", finishedAt: "2026-10-24T01:00:00Z" }],
      }),
      steps: [before, current],
    };
    expect(stepsForAttempt(run, 2).map((entry) => entry.id)).toEqual(["new"]);
    expect(stepsForAttempt(run, 1).map((entry) => entry.id)).toEqual(["old"]);
  });
  it("does not show old steps while a retried attempt is still queued", () => {
    const previous = job("old", "2026-10-24T00:01:00Z", { status: "failed" });
    const run = { ...job("root", "2026-10-24T00:00:00Z", { attempt: 2, status: "queued" }), steps: [previous] };
    expect(stepsForAttempt(run, 2)).toEqual([]);
  });
  it("keeps a zero-duration timeline finite", () => {
    const at = "2026-10-25T00:00:00Z";
    const result = timelineOf([job("instant", at, { startedAt: at, finishedAt: at })], Date.parse(at));
    expect(result.totalMs).toBe(1);
    expect(Number.isFinite(result.rows[0]!.offsetPct)).toBe(true);
    expect(Number.isFinite(result.rows[0]!.widthPct)).toBe(true);
  });
});
describe("run search", () => {
  it("searches scope and set names while respecting the status filter", () => {
    const runs = [
      job("a", "", { status: "failed", scope: { items: ["accounts/customer"], set: "detail-design" } }),
      job("b", "", { scope: { items: ["accounts/customer"] } }),
    ];
    expect(filterJobRuns(runs, "failed", " CUSTOMER ").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterJobRuns(runs, "", "detail-design").map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("nested console labels", () => {
  it("resolves a job name from lifecycle events when its branch has not been loaded", () => {
    const events = [
      event("1", {
        kind: "step.finished",
        stepRunId: "nested",
        message: "agent security-auditor failed: invalid result",
        data: { status: "failed" },
      }),
      event("2", { stepRunId: "nested", message: "read file" }),
    ];
    expect(eventStepLabels(events).get("nested")).toBe("Security auditor");
  });
});

describe("the retry notice", () => {
  it("says which agents' steps run again because they look things up on the web", () => {
    expect(retryNotice({}, false)).toBe("Reuses the steps whose inputs have not changed.");
    expect(retryNotice({ rerunsWebAgents: ["legacy-analyst"] }, false)).toBe(
      "Reuses the steps whose inputs have not changed. Steps of Legacy analyst run again: it looks things up on the web, and what it finds may have changed.",
    );
    expect(retryNotice({ rerunsWebAgents: ["legacy-analyst"] }, true)).toBe("Starts again from the pinned source commits.");
  });
});
