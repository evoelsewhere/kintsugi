// The agent works in the job workspace (ADR-0055): a relative path is read against its root, a search without a path
// looks in the first read-only directory, and the root as a whole is not readable.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelGrepTool } from "../src/kernel/grep.js";
import { createKernelLsTool } from "../src/kernel/ls.js";
import { PathGuard } from "../src/kernel/paths.js";
import { OUTPUT_FOLDER_NOTE, createTools, linesShown, type SourceRead } from "../src/kernel/tools.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
const run = async (tool: { execute: unknown }, params: Record<string, unknown>): Promise<{ text: string; error: boolean }> => {
  try {
    const result = (await (tool.execute as (id: string, params: unknown) => Promise<Result>)("call", params)) as Result;
    return { text: result.content.map((part) => part.text ?? "").join(""), error: result.isError === true };
  } catch (error) {
    return { text: String(error), error: true };
  }
};

describe("a workspace root above the read-only folders", () => {
  const asIs = join(workspace.root, "as-is");
  const stepIn = join(workspace.root, "steps", "s1", "in");
  const guide = join(workspace.root, "WORKSPACE.md");
  const guard = (): PathGuard => new PathGuard([asIs, stepIn, guide]);

  beforeAll(() => {
    mkdirSync(join(asIs, "web", "src"), { recursive: true });
    mkdirSync(stepIn, { recursive: true });
    writeFileSync(join(asIs, "web", "src", "App.vue"), "<template>SELECT me</template>\n");
    writeFileSync(join(stepIn, "plan.md"), "# plan\n");
    writeFileSync(guide, "# guide\n");
    mkdirSync(join(workspace.root, ".state"), { recursive: true });
    writeFileSync(join(workspace.root, ".state", "ledger.json"), "{}");
  });

  it("greps and lists the as-is folder when given no path, with paths that read as citations", async () => {
    const grep = await run(createKernelGrepTool(workspace.root, guard(), asIs), { pattern: "SELECT" });
    expect(grep).toEqual({ text: "web/src/App.vue:1: <template>SELECT me</template>", error: false });
    const ls = await run(createKernelLsTool(workspace.root, guard(), asIs), { tree: true });
    expect(ls.text).toContain("web/");
    expect(ls.text).toContain("App.vue");
  });

  it("reads by a path relative to the root, the guide included, and refuses the rest of the root", async () => {
    const tools = createTools(["read", "find"], { cwd: workspace.root, searchDir: asIs, readOnly: [asIs, stepIn, guide], outDir: workspace.out, tmpDir: workspace.outside, onOutput: () => undefined });
    const [read, find] = tools as unknown as [{ execute: unknown }, { execute: unknown }];
    expect((await run(read, { path: "as-is/web/src/App.vue" })).text).toContain("SELECT me");
    expect((await run(read, { path: "WORKSPACE.md" })).text).toContain("# guide");
    expect((await run(read, { path: "steps/s1/in/plan.md" })).text).toContain("# plan");
    const state = await run(read, { path: ".state/ledger.json" });
    expect(state.text).toMatch(/outside the job workspace/);
    const found = await run(find, { pattern: "**/*.vue" });
    expect(found.text).toContain("web/src/App.vue");
  });

  it("answers a search of the output folder with a note instead of a denial", async () => {
    mkdirSync(join(workspace.out, "docs"), { recursive: true });
    writeFileSync(join(workspace.out, "docs", "written.md"), "# written\n");
    const tools = createTools(["ls", "grep", "find", "glob"], { cwd: workspace.root, searchDir: asIs, readOnly: [asIs, stepIn, guide], outDir: workspace.out, tmpDir: workspace.outside, onOutput: () => undefined });
    for (const tool of tools as unknown as Array<{ execute: unknown }>) {
      const result = await run(tool, { path: "out/docs", pattern: "written" });
      expect(result).toEqual({ text: OUTPUT_FOLDER_NOTE, error: false });
      expect((await run(tool, { path: workspace.out, pattern: "*" })).text).toBe(OUTPUT_FOLDER_NOTE);
    }
    const [ls] = tools as unknown as [{ execute: unknown }];
    expect((await run(ls, { path: "as-is/web" })).text).toContain("src");
  });

  it("reports the lines read showed the model, and nothing for a read that failed", async () => {
    const reads: SourceRead[] = [];
    const [read] = createTools(["read"], { cwd: workspace.root, searchDir: asIs, readOnly: [asIs, stepIn, guide], outDir: workspace.out, tmpDir: workspace.outside, onOutput: () => undefined, onRead: (entry) => reads.push(entry) }) as unknown as [{ execute: unknown }];
    await run(read, { path: "as-is/web/src/App.vue" });
    await run(read, { path: "as-is/web/src/App.vue", offset: 1, limit: 5 });
    await run(read, { path: ".state/ledger.json" });
    expect(reads.map((entry) => ({ ...entry, path: entry.path.slice(workspace.root.length + 1).replaceAll("\\", "/") }))).toEqual([
      { tool: "read", path: "as-is/web/src/App.vue", from: 1, to: null },
      { tool: "read", path: "as-is/web/src/App.vue", from: 1, to: 5 },
    ]);
  });
});

describe("linesShown", () => {
  it("takes the lines the output kept, the limit, or the rest of the file", () => {
    expect(linesShown({ offset: 10 }, { truncation: { truncated: true, outputLines: 2000 } })).toEqual({ from: 10, to: 2009 });
    expect(linesShown({ offset: 3, limit: 4 }, undefined)).toEqual({ from: 3, to: 6 });
    expect(linesShown({}, { truncation: { truncated: false } })).toEqual({ from: 1, to: null });
    expect(linesShown({ offset: 7 }, { truncation: { truncated: true, firstLineExceedsLimit: true } })).toBeUndefined();
  });
});
