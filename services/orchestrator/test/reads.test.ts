import { describe, expect, it } from "vitest";
import { mergeRange, ReadRecord } from "../src/jobs/reads.js";

const read = (path: string, from: number, to: number | null) => ({ type: "source.read" as const, jobId: "j1", tool: "read" as const, path, from, to });

describe("mergeRange", () => {
  it("merges what overlaps or touches and keeps the rest sorted", () => {
    expect(mergeRange([[1, 5], [20, 30]], [6, 9])).toEqual([[1, 9], [20, 30]]);
    expect(mergeRange([[1, 5], [20, 30]], [10, 12])).toEqual([[1, 5], [10, 12], [20, 30]]);
    expect(mergeRange([[1, 5], [20, 30]], [4, 21])).toEqual([[1, 30]]);
    expect(mergeRange([[10, 12]], [1, 2])).toEqual([[1, 2], [10, 12]]);
    expect(mergeRange([[1, 5], [20, 30]], [25, null])).toEqual([[1, 5], [20, null]]);
    expect(mergeRange([[50, null]], [1, 60])).toEqual([[1, null]]);
  });
});

describe("ReadRecord", () => {
  it("keeps the reads of the legacy checkouts as citations name them, merged per file", () => {
    const record = new ReadRecord("as-is");
    record.add(read("as-is/legacy/src/TAX.cbl", 1, 40));
    record.add(read("as-is/legacy/src/TAX.cbl", 41, 60));
    record.add(read("as-is/legacy/src/A.cbl", 5, null));
    record.add(read("steps/s1/in/10-applications/billing/plan.md", 1, null));
    record.add({ type: "tool.call", jobId: "j1", callId: "c1", tool: "read", input: {}, decision: "allowed" });
    expect(record.toJSON("legacy-analyst@1.4.0")).toEqual({
      agent: "legacy-analyst@1.4.0",
      complete: true,
      unrecorded: {},
      files: { "legacy/src/A.cbl": [[5, null]], "legacy/src/TAX.cbl": [[1, 60]] },
    });
  });

  it("is not complete once a tool that reads without telling which lines ran", () => {
    const record = new ReadRecord();
    record.add({ type: "tool.call", jobId: "j1", callId: "c1", tool: "shell", input: { command: "sed -n 1,9p as-is/legacy/src/TAX.cbl" }, decision: "allowed" });
    record.add({ type: "tool.call", jobId: "j1", callId: "c2", tool: "shell", input: {}, decision: "allowed" });
    record.add({ type: "tool.call", jobId: "j1", callId: "c3", tool: "git", input: {}, decision: "blocked", reason: "denied" });
    expect(record.toJSON("a@1")).toMatchObject({ complete: false, unrecorded: { shell: 2 } });
  });
});
