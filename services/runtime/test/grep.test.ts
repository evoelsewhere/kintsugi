import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelGrepTool, globToRegExp } from "../src/kernel/grep.js";
import { PathGuard } from "../src/kernel/paths.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
afterAll(() => workspace.remove());

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function grep(params: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const tool = createKernelGrepTool(workspace.src, new PathGuard([workspace.src]));
  const result = (await (tool.execute as unknown as (id: string, params: unknown) => Promise<Result>)("call", params)) as Result;
  return { text: result.content.map((part) => part.text ?? "").join(""), error: result.isError === true };
}

describe("globToRegExp", () => {
  it("matches file names anywhere without a slash, paths with one", () => {
    expect(globToRegExp("*.java").test("src/billing/Account.java")).toBe(true);
    expect(globToRegExp("*.java").test("src/billing/Account.javax")).toBe(false);
    expect(globToRegExp("src/*.java").test("src/billing/Account.java")).toBe(false);
    expect(globToRegExp("src/**/*.java").test("src/billing/Account.java")).toBe(true);
    expect(globToRegExp("**/*.{yml,yaml}").test("config/app.yaml")).toBe(true);
    expect(globToRegExp("?.sql").test("a.sql")).toBe(true);
  });
});

describe("kernel grep", () => {
  beforeAll(() => {
    mkdirSync(join(workspace.src, "src"), { recursive: true });
    writeFileSync(join(workspace.src, "src", "Repo.java"), 'class Repo {\n  String q = "SELECT * FROM T WHERE ID = " + id;\n  int x;\n}\n');
    writeFileSync(join(workspace.src, "src", "notes.md"), "SELECT nothing here\n");
    writeFileSync(join(workspace.src, "blob.bin"), Buffer.from([0x53, 0x45, 0x4c, 0x00, 0x45, 0x43, 0x54]));
    mkdirSync(join(workspace.src, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(workspace.src, "node_modules", "dep", "index.js"), "SELECT from a dependency\n");
  });

  it("finds matches with file:line, honouring glob and case", async () => {
    const { text, error } = await grep({ pattern: "select \\*", ignoreCase: true, glob: "*.java" });
    expect(error).toBe(false);
    expect(text).toBe('src/Repo.java:2:   String q = "SELECT * FROM T WHERE ID = " + id;');
  });

  it("shows context lines and skips binary files and node_modules", async () => {
    const { text } = await grep({ pattern: "SELECT", context: 1 });
    expect(text).toContain("src/Repo.java-1- class Repo {");
    expect(text).toContain("src/Repo.java-3-   int x;");
    expect(text).toContain("src/notes.md:1: SELECT nothing here");
    expect(text).not.toContain("blob.bin");
    expect(text).not.toContain("node_modules");
  });

  it("treats a literal pattern literally and reports no matches plainly", async () => {
    expect((await grep({ pattern: "* FROM", literal: true })).text).toContain("src/Repo.java:2:");
    expect((await grep({ pattern: "NOT_THERE" })).text).toBe("No matches found");
  });

  it("reports the lines it showed, matches and context, one read per run of lines", async () => {
    const reads: unknown[] = [];
    const tool = createKernelGrepTool(workspace.src, new PathGuard([workspace.src]), workspace.src, (read) => reads.push({ ...read, path: read.path.slice(workspace.src.length + 1).replaceAll("\\", "/") }));
    await (tool.execute as unknown as (id: string, params: unknown) => Promise<Result>)("call", { pattern: "SELECT", context: 1 });
    expect(reads).toEqual([
      { tool: "grep", path: "src/Repo.java", from: 1, to: 3 },
      // The file ends with a newline: its empty last line is shown as context.
      { tool: "grep", path: "src/notes.md", from: 1, to: 2 },
    ]);
  });

  it("stops at the match limit", async () => {
    const { text } = await grep({ pattern: "SELECT", limit: 1 });
    expect(text).toContain("1 matches limit reached");
  });

  it("refuses paths outside the workspace and invalid patterns", async () => {
    expect(await grep({ pattern: "SECRET", path: workspace.outside })).toMatchObject({ error: true });
    expect((await grep({ pattern: "(" })).text).toMatch(/^Invalid pattern/);
  });

  it("does not follow symbolic links out of the workspace", async (context) => {
    try {
      symlinkSync(workspace.outside, join(workspace.src, "link"), "junction");
    } catch {
      context.skip();
    }
    expect((await grep({ pattern: "TOP_SECRET_VALUE" })).text).toBe("No matches found");
  });
});
