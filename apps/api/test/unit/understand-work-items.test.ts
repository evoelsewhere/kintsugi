import { describe, expect, it } from "vitest";
import { type StageSource, understandResults } from "#modules/delivery/documents/application/stage-results.builders.js";
import { catalogDocuments, understoodUnit } from "../support/documents.js";

/** The catalog of web: three items of one module; a and b are understood, c is not. */
const CATALOG = catalogDocuments("web", [{ id: "core", name: "Core" }], [
  { id: "core/a", files: ["src/a.js"] },
  { id: "core/b", files: ["src/b.js"] },
  { id: "core/c", files: ["src/c.js"] },
]);
const UNDERSTOOD = {
  ...understoodUnit("web", "core/a", { digest: "sha256:a", commit: "a".repeat(40) }),
  ...understoodUnit("web", "core/b", { digest: "sha256:b", commit: "a".repeat(40) }),
};

const item = (id: string, status: string) => `---\nid: "${id}"\nstatus: ${status}\ncomplexity: low\n---\n\nText.\n`;

/** A stage source over a map of repo paths (the stage directory is 10-applications/web/_generated). */
function sourceOf(files: Record<string, string>): StageSource {
  return {
    files: [],
    read: (name) => Promise.resolve(files[`10-applications/web/_generated/${name}`] ?? null),
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
    ...CATALOG,
    ...UNDERSTOOD,
    "10-applications/web/02-modern/core/a/README.md": item("web/core/a", "pending"),
    "10-applications/web/02-modern/core/b/README.md": item("web/core/b", "pending"),
  });

  it("reads status from the default branch once an item is merged there, else shows it as proposed", async () => {
    const main = sourceOf({ "10-applications/web/02-modern/core/a/README.md": item("web/core/a", "in-progress") });
    const results = await understandResults(branch, "10-applications/web/_generated", "web", [], main);
    // Only the understood units are rows of the matrix.
    expect(results.units.map((unit) => [unit.id, unit.workItem ?? null])).toEqual([
      ["web/core/a", { path: "10-applications/web/02-modern/core/a/README.md", status: "in-progress", complexity: "low", statusFrom: "default-branch" }],
      ["web/core/b", { path: "10-applications/web/02-modern/core/b/README.md", status: "proposed", complexity: "low", statusFrom: "ref" }],
    ]);
    expect(results.counts["workItems"]).toBe(2);
    expect(results.units[0]?.spec).toBe("10-applications/web/01-legacy/core/a/spec.md");
  });

  it("uses the items' own status at the default branch", async () => {
    const results = await understandResults(branch, "10-applications/web/_generated", "web", []);
    expect(results.units[0]?.workItem).toEqual({ path: "10-applications/web/02-modern/core/a/README.md", status: "pending", complexity: "low" });
  });

  it("carries each unit's trace links and rule verdicts instead of dropping them", async () => {
    const trace = (requirements: string, pullRequests: string, tests: string): string =>
      `---\napp: "web"\nitem: "core/a"\nopenQuestions: 0\n---\n# Traceability - core/a\n\n## Rules applied\n\n- \`RULE-core.a-1a2b3c4d\`\n\n## Requirements\n\n- ${requirements}\n\n## Pull requests\n\n- ${pullRequests}\n\n## Tests\n\n- ${tests}\n`;
    const source = sourceOf({
      ...CATALOG,
      ...UNDERSTOOD,
      "10-applications/web/01-legacy/core/a/trace.md": trace("REQ-1", "PR-7", "T#billing"),
      "10-applications/web/01-legacy/core/a/rules.md": "# Business rules - core/a\n\n## Calculation\n\n### RULE-core.a-1a2b3c4d: A\n**Priority:** P0\n**Source:** `src/a.js:1`\n",
      "10-applications/web/01-legacy/core/a/rules-review.md":
        "| Rule | Verdict | Approver | Date |\n| --- | --- | --- | --- |\n| RULE-core.a-1a2b3c4d | confirmed | alice | 2026-10-15 |\n| RULE-gone | refuted | alice | 2026-10-15 |\n",
    });
    const results = await understandResults(source, "10-applications/web/_generated", "web", []);
    expect(results.units[0]?.trace).toEqual({ requirements: ["REQ-1"], pullRequests: ["PR-7"], tests: ["T#billing"] });
    expect(results.units[0]?.rulesReview).toEqual({
      verdicts: {
        "RULE-core.a-1a2b3c4d": { verdict: "confirmed", approver: "alice", date: "2026-10-15" },
        "RULE-gone": { verdict: "refuted", approver: "alice", date: "2026-10-15" },
      },
      orphaned: ["RULE-gone"],
    });
    // Unit b has a trace document without links and no verdicts.
    expect(results.units[1]?.trace).toEqual({ requirements: [], pullRequests: [], tests: [] });
    expect(results.units[1]?.rulesReview).toBeUndefined();
  });

  it("builds the matrix of one unit only", async () => {
    const results = await understandResults(branch, "10-applications/web/01-legacy/core/b", "web", [], undefined, "core/b");
    expect(results.units.map((unit) => unit.id)).toEqual(["web/core/b"]);
    expect(results.counts["units"]).toBe(1);
  });
});
