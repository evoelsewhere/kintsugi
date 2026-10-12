import { describe, expect, it } from "vitest";
import { type StageSource, understandResults } from "#modules/delivery/documents/application/stage-results.builders.js";

const TRACEABILITY = JSON.stringify({
  application: "web",
  units: [
    { id: "web/core/a", module: "core", unit: "a", title: "A", files: ["src/a.js"], spec: "knowledge/as-is/web/core/a.md" },
    { id: "web/core/b", module: "core", unit: "b", title: "B", files: ["src/b.js"], spec: "knowledge/as-is/web/core/b.md" },
    { id: "web/core/c", module: "core", unit: "c", title: "C", files: ["src/c.js"], spec: null },
  ],
});

const item = (id: string, status: string) => `---\nid: "${id}"\nstatus: ${status}\ncomplexity: low\n---\n\nText.\n`;

/** A stage source over a map of repo paths (the stage directory is knowledge/as-is/web). */
function sourceOf(files: Record<string, string>): StageSource {
  return {
    files: [],
    read: (name) => Promise.resolve(files[`knowledge/as-is/web/${name}`] ?? null),
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
    "knowledge/as-is/web/traceability.json": TRACEABILITY,
    "units/web/core/a.md": item("web/core/a", "pending"),
    "units/web/core/b.md": item("web/core/b", "pending"),
  });

  it("reads status from the default branch once an item is merged there, else shows it as proposed", async () => {
    const main = sourceOf({ "units/web/core/a.md": item("web/core/a", "in-progress") });
    const results = await understandResults(branch, "knowledge/as-is/web", "web", [], main);
    expect(results.units.map((unit) => [unit.id, unit.workItem ?? null])).toEqual([
      ["web/core/a", { path: "units/web/core/a.md", status: "in-progress", complexity: "low", statusFrom: "default-branch" }],
      ["web/core/b", { path: "units/web/core/b.md", status: "proposed", complexity: "low", statusFrom: "ref" }],
      ["web/core/c", null],
    ]);
    expect(results.counts["workItems"]).toBe(2);
  });

  it("uses the items' own status at the default branch", async () => {
    const results = await understandResults(branch, "knowledge/as-is/web", "web", []);
    expect(results.units[0]?.workItem).toEqual({ path: "units/web/core/a.md", status: "pending", complexity: "low" });
  });
});
