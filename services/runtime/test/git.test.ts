// The kernel git tool (ADR-0040): read-only subcommands anywhere in the workspace, mutating ones
// only where the job may write, and no alias/option path to a command or another repository.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelGitTool } from "../src/kernel/git.js";
import { PathGuard } from "../src/kernel/paths.js";
import { createWorkspace } from "./helpers.js";

const workspace = createWorkspace();
const tmp = join(workspace.root, "tmp");
afterAll(() => workspace.remove());

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function git(params: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const tool = createKernelGitTool(
    workspace.src,
    new PathGuard([workspace.src, workspace.out, tmp]),
    new PathGuard([workspace.out, tmp]),
    tmp,
  );
  try {
    const result = (await (tool.execute as unknown as (id: string, params: unknown) => Promise<Result>)("call", params)) as Result;
    return { text: result.content.map((part) => part.text ?? "").join(""), error: result.isError === true };
  } catch (error) {
    return { text: String(error), error: true };
  }
}

describe("kernel git", () => {
  const srcRepo = workspace.src;
  const writeRepo = join(workspace.out, "clone");

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    // A repository the job only reads (test setup: the tool itself would refuse to create it here).
    execFileSync("git", ["init", "-q"], { cwd: srcRepo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "--allow-empty", "-m", "first"], { cwd: srcRepo });
  });

  it("runs read-only subcommands in a read-only repository", async () => {
    const { text, error } = await git({ args: ["log", "--oneline"], cwd: srcRepo });
    expect(error).toBe(false);
    expect(text).toContain("first");
  });

  it("clones into the writable area and commits with the job identity", async () => {
    const clone = await git({ args: ["clone", "-q", srcRepo, writeRepo], cwd: workspace.out });
    expect(clone.text).toBe("(no output)");
    writeFileSync(join(writeRepo, "note.txt"), "from a git-only agent");
    expect((await git({ args: ["add", "note.txt"], cwd: writeRepo })).error).toBe(false);
    const commit = await git({ args: ["commit", "-q", "-m", "second"], cwd: writeRepo });
    expect(commit.error).toBe(false);
    const { text, error } = await git({ args: ["log", "--oneline"], cwd: writeRepo });
    expect(error).toBe(false);
    expect(text).toContain("second");
  });

  it("refuses mutating subcommands in a read-only repository", async () => {
    const { text } = await git({ args: ["commit", "-m", "x"], cwd: srcRepo });
    expect(text).toContain("writable area");
  });

  it("refuses unknown subcommands instead of expanding aliases", async () => {
    const { text } = await git({ args: ["pwn"], cwd: writeRepo });
    expect(text).toContain("unknown git subcommand");
  });

  it("refuses options that redirect the repository or start a helper", async () => {
    expect((await git({ args: ["log", "--git-dir", workspace.outside], cwd: writeRepo })).text).toContain("is not allowed");
    expect((await git({ args: ["clone", "-u", "evil", srcRepo, join(workspace.out, "x")], cwd: workspace.out })).text).toContain("is not allowed");
    expect((await git({ args: ["log", "--ext-diff"], cwd: writeRepo })).text).toContain("is not allowed");
    expect((await git({ args: ["submodule", "foreach", "evil"], cwd: writeRepo })).text).toContain("not allowed");
  });

  it("keeps the workspace guard: a cwd outside the job workspace is refused", async () => {
    const { text } = await git({ args: ["status"], cwd: workspace.outside });
    expect(text).toContain("outside the job workspace");
  });
});

describe("kernel git diff", () => {
  const repo = join(workspace.out, "diffs");
  const commit = (message: string): void => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-am", message], { cwd: repo });
  };

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "one\n");
    execFileSync("git", ["add", "a.txt"], { cwd: repo });
    commit("one");
    writeFileSync(join(repo, "a.txt"), "two\n");
    commit("two");
  });

  it("shows a diff between two commits, between two revisions and of the working tree", async () => {
    const between = await git({ args: ["diff", "HEAD~1", "HEAD"], cwd: repo });
    expect(between.error, between.text).toBe(false);
    expect(between.text).toContain("-one");
    expect(between.text).toContain("+two");
    const first = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: repo, encoding: "utf8" }).trim();
    expect((await git({ args: ["diff", first, "HEAD", "--", "a.txt"], cwd: repo })).text).toContain("+two");
    writeFileSync(join(repo, "a.txt"), "three\n");
    try {
      const working = await git({ args: ["diff"], cwd: repo });
      expect(working.text).toContain("-two");
      expect(working.text).toContain("+three");
    } finally {
      writeFileSync(join(repo, "a.txt"), "two\n");
    }
  });

  it("never runs a diff driver or converter the repository configures", async () => {
    const marker = join(workspace.root, "driver-ran.txt").replaceAll("\\", "/");
    execFileSync("git", ["config", "diff.external", `echo ran >'${marker}'; true`], { cwd: repo });
    execFileSync("git", ["config", "diff.probe.textconv", `echo ran >'${marker}'; cat`], { cwd: repo });
    writeFileSync(join(repo, ".gitattributes"), "*.txt diff=probe\n");
    try {
      // Plain git does run them: the probe is real.
      execFileSync("git", ["diff", "HEAD~1", "HEAD"], { cwd: repo, stdio: "ignore" });
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);
      for (const args of [["diff", "HEAD~1", "HEAD"], ["log", "-p", "-1"], ["show", "HEAD"]]) {
        const { text, error } = await git({ args, cwd: repo });
        expect(error, `${args.join(" ")}: ${text}`).toBe(false);
        expect(text).toContain("+two");
      }
      expect(existsSync(marker)).toBe(false);
    } finally {
      execFileSync("git", ["config", "--unset", "diff.external"], { cwd: repo });
      execFileSync("git", ["config", "--unset", "diff.probe.textconv"], { cwd: repo });
      rmSync(join(repo, ".gitattributes"));
    }
  });

  it("refuses to compare files outside a repository, with --no-index or with a path outside the workspace", async () => {
    const outside = join(workspace.outside, "token.txt");
    const noIndex = await git({ args: ["diff", "--no-index", "a.txt", "b.txt"], cwd: repo });
    expect(noIndex.text).toContain("not allowed");
    for (const args of [["diff", outside, "a.txt"], ["diff", "HEAD", "--", outside], ["diff", "../../outside/token.txt", "a.txt"]]) {
      const { text } = await git({ args, cwd: repo });
      expect(text).toContain("outside the job workspace");
      expect(text).not.toContain("TOP_SECRET_VALUE");
    }
  });
});
