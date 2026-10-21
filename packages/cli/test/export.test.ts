import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderBriefMarkdown, renderBriefText, writeBrief } from "../src/render.js";
import type { TaskBrief } from "@kintsugi/harness-sdk";

const brief: TaskBrief = {
  schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", activity: "implementation", title: "Invoice",
  objective: "Implement invoice calculation.", acceptanceCriteria: ["Use documented rounding."], snapshotId: "ctx_private",
  contextRevision: "sha256:" + "a".repeat(64), documentRepoCommit: "b".repeat(40), sources: [{ sourceId: "src_task", role: "task", repositoryId: "docs", path: "units/invoice/task.md", availability: "present", publication: "published", approval: { status: "approved" }, commit: "b".repeat(40), contentHash: "sha256:" + "c".repeat(64) }], requiredDeliverableIds: [],
  readiness: { readyFor: [], blockers: [], byActivity: {
    design: { ready: false, blockers: [] }, implementation: { ready: false, blockers: [] }, verification: { ready: false, blockers: [] },
  } }, blockers: [], requiredContextStatus: "partial", sections: [{ sourceId: "src_task", sectionId: "sec_task", title: "Task design", text: "Use documented rounding rules.", required: true, citation: { sourceId: "src_task", path: "units/invoice/task.md", startLine: 12, endLine: 13 } }],
  omittedSections: [{ sourceId: "src_design", sectionId: "sec_rules", required: true }],
  freshness: { isCurrent: true, observedAt: "2026-10-21T00:00:00.000Z" }, fetchedAt: "2026-10-21T00:00:00.000Z",
};

let directory: string | undefined;
afterEach(async () => { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe("private brief export", () => {
  it("includes snapshot provenance and every omitted mandatory section", () => {
    const markdown = renderBriefMarkdown(brief);
    expect(markdown).toContain("ctx_private");
    expect(markdown).toContain("sha256:" + "a".repeat(64));
    expect(markdown).toContain("sec_rules");
    expect(markdown).toContain("required context is partial");
    expect(markdown).toContain("Do not begin implementation work");
    expect(markdown).toContain("units/invoice/task.md#L12-L13");
    const text = renderBriefText(brief);
    expect(text).toContain("Use documented rounding rules.");
    expect(text).toContain("Source: src_task — units/invoice/task.md#L12-L13");
  });

  it("creates a private file and refuses to overwrite an existing destination", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-brief-export-"));
    const path = join(directory, "brief.md");
    await writeBrief(path, brief, { overwrite: false });
    expect(await readFile(path, "utf8")).toBe(renderBriefMarkdown(brief));
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(writeBrief(path, { ...brief, title: "Changed" }, { overwrite: false })).rejects.toMatchObject({ code: "EXPORT_EXISTS" });
    expect(await readFile(path, "utf8")).toBe(renderBriefMarkdown(brief));
  });
});
