import { describe, expect, it } from "vitest";
import { type StageSource, understandResults } from "#modules/delivery/documents/application/stage-results.builders.js";

const TRACEABILITY = JSON.stringify({
  application: "web",
  units: [
    { id: "web/core/a", module: "core", unit: "a", title: "A", files: ["src/a.js"], spec: "applications/web/units/core/a/as-is.md" },
    { id: "web/core/b", module: "core", unit: "b", title: "B", files: ["src/b.js"], spec: "applications/web/units/core/b/as-is.md" },
    { id: "web/core/c", module: "core", unit: "c", title: "C", files: ["src/c.js"], spec: null },
  ],
});

const item = (id: string, status: string) => `---\nid: "${id}"\nstatus: ${status}\ncomplexity: low\n---\n\nText.\n`;

/** A stage source over a map of repo paths (the stage directory is applications/web/generated). */
function sourceOf(files: Record<string, string>): StageSource {
  return {
    files: [],
    read: (name) => Promise.resolve(files[`applications/web/generated/${name}`] ?? null),
    list: (path) =>
      Promise.resolve(
        Object.entries(files)
          .filter(([file]) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/"))
          .map(([file, text]) => ({ path: file, size: text.length })),
      ),
    readPath: (path) => Promise.resolve(files[path] ?? null),
  };
}

describe("understand work items", () => {
  const branch = sourceOf({
    "applications/web/generated/traceability.json": TRACEABILITY,
    "applications/web/units/core/a/unit.md": item("web/core/a", "pending"),
    "applications/web/units/core/b/unit.md": item("web/core/b", "pending"),
  });

  it("reads status from the default branch once an item is merged there, else shows it as proposed", async () => {
    const main = sourceOf({ "applications/web/units/core/a/unit.md": item("web/core/a", "in-progress") });
    const results = await understandResults(branch, "applications/web/generated", "web", [], main);
    expect(results.units.map((unit) => [unit.id, unit.workItem ?? null])).toEqual([
      ["web/core/a", { path: "applications/web/units/core/a/unit.md", status: "in-progress", complexity: "low", statusFrom: "default-branch" }],
      ["web/core/b", { path: "applications/web/units/core/b/unit.md", status: "proposed", complexity: "low", statusFrom: "ref" }],
      ["web/core/c", null],
    ]);
    expect(results.counts["workItems"]).toBe(2);
  });

  it("uses the items' own status at the default branch", async () => {
    const results = await understandResults(branch, "applications/web/generated", "web", []);
    expect(results.units[0]?.workItem).toEqual({ path: "applications/web/units/core/a/unit.md", status: "pending", complexity: "low" });
  });

  it("carries each unit's trace links and rule verdicts instead of dropping them", async () => {
    const source = sourceOf({
      "applications/web/generated/traceability.json": TRACEABILITY,
      "applications/web/units/core/a/trace.json": JSON.stringify({ requirements: ["REQ-1"], pullRequests: ["PR-7"], tests: ["T#billing"] }),
      "applications/web/units/core/a/rules.json": JSON.stringify({ rules: [{ id: "RULE-a-01", name: "A" }] }),
      "applications/web/units/core/a/rules-review.json": JSON.stringify({
        "RULE-a-01": { verdict: "confirmed", approver: "alice", date: "2026-10-15" },
        "RULE-gone": { verdict: "refuted", approver: "alice", date: "2026-10-15" },
      }),
    });
    const results = await understandResults(source, "applications/web/generated", "web", []);
    expect(results.units[0]?.trace).toEqual({ requirements: ["REQ-1"], pullRequests: ["PR-7"], tests: ["T#billing"] });
    expect(results.units[0]?.rulesReview).toEqual({
      verdicts: {
        "RULE-a-01": { verdict: "confirmed", approver: "alice", date: "2026-10-15" },
        "RULE-gone": { verdict: "refuted", approver: "alice", date: "2026-10-15" },
      },
      orphaned: ["RULE-gone"],
    });
    expect(results.units[1]?.trace).toBeUndefined();
    expect(results.units[1]?.rulesReview).toBeUndefined();
  });
});
