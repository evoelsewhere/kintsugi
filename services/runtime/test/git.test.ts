// The kernel git tool (ADR-0040): read-only subcommands anywhere in the workspace, mutating ones
// only where the job may write, and no alias/option path to a command or another repository.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKernelGitTool, findUnlistedOption } from "../src/kernel/git.js";
import { createTools } from "../src/kernel/tools.js";
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
    execFileSync("git", ["config", "diff.probe.command", `echo ran >'${marker}'; true`], { cwd: repo });
    writeFileSync(join(repo, ".gitattributes"), "*.txt diff=probe\n");
    try {
      // Plain git does run them: the probe is real.
      execFileSync("git", ["diff", "HEAD~1", "HEAD"], { cwd: repo, stdio: "ignore" });
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);
      execFileSync("git", ["blame", "a.txt"], { cwd: repo, stdio: "ignore" });
      expect(existsSync(marker), "plain blame runs the converter").toBe(true);
      rmSync(marker);
      for (const args of [["diff", "HEAD~1", "HEAD"], ["log", "-p", "-1"], ["show", "HEAD"]]) {
        const { text, error } = await git({ args, cwd: repo });
        expect(error, `${args.join(" ")}: ${text}`).toBe(false);
        expect(text).toContain("+two");
      }
      const blame = await git({ args: ["blame", "a.txt"], cwd: repo });
      expect(blame.error, blame.text).toBe(false);
      expect(blame.text).toContain("two");
      expect(existsSync(marker)).toBe(false);
    } finally {
      execFileSync("git", ["config", "--unset", "diff.external"], { cwd: repo });
      execFileSync("git", ["config", "--unset", "diff.probe.textconv"], { cwd: repo });
      execFileSync("git", ["config", "--unset", "diff.probe.command"], { cwd: repo });
      rmSync(join(repo, ".gitattributes"));
    }
  });

  it("refuses submodule recursion, files read into a blame or a message, and patches applied outside the tree (P-004)", async () => {
    const secret = join(workspace.outside, "token.txt");
    const cases: string[][] = [
      ["clone", "--recurse-submodules", repo, join(workspace.out, "sub")],
      ["fetch", "--recurse-submodules=yes"],
      ["blame", "--contents", secret, "a.txt"],
      ["commit", "-F", secret],
      ["commit", "-qF", secret],
      ["commit", `--file=${secret}`],
      ["tag", "-F", secret, "t1"],
      ["merge", "-F", secret, "HEAD"],
      ["apply", "--unsafe-paths", "p.diff"],
    ];
    for (const args of cases) {
      const { text } = await git({ args, cwd: repo });
      expect(text, args.join(" ")).toContain("is not allowed");
      expect(text, args.join(" ")).not.toContain("TOP_SECRET_VALUE");
    }
    // A message given inline still works.
    expect((await git({ args: ["tag", "-m", "release", "t2"], cwd: repo })).error).toBe(false);
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

describe("kernel git confinement (T3-003)", () => {
  const repo = join(workspace.out, "confined");
  const marker = join(workspace.root, "command-ran.txt").replaceAll("\\", "/");

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "a\n");
    execFileSync("git", ["add", "a.txt"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "a"], { cwd: repo });
  });

  it("lets config read, never write or read a file of its choosing", async () => {
    expect((await git({ args: ["config", "--get", "core.bare"], cwd: repo })).text).toContain("false");
    expect((await git({ args: ["config", "--list"], cwd: repo })).error).toBe(false);
    for (const args of [
      ["config", "filter.probe.clean", `touch '${marker}'; cat`],
      ["config", "--add", "core.sshCommand", "x"],
      ["config", "--unset", "core.bare"],
      ["config", "--global", "user.name", "x"],
      ["config", "--file", join(workspace.outside, "token.txt"), "--list"],
      ["config", "-f/etc/gitconfig", "--list"],
      ["config", "set", "core.bare", "true"],
    ]) {
      expect((await git({ args, cwd: repo })).text, args.join(" ")).toContain("only reads");
    }
  });

  it("makes repositories only in the writable area, and clones only from inside the workspace", async () => {
    const away = join(workspace.outside, "made");
    for (const args of [["init", away], ["clone", repo, away], ["clone", "--origin", "up", repo, away], ["worktree", "add", away]]) {
      const { text } = await git({ args, cwd: repo });
      expect(text, args.join(" ")).toContain("writable area");
    }
    for (const source of [workspace.outside, `file:///${workspace.outside.replaceAll("\\", "/").replace(/^\//, "")}`]) {
      expect((await git({ args: ["clone", source, join(workspace.out, "from-outside")], cwd: workspace.out })).text, source).toContain("inside the job workspace");
    }
    expect(existsSync(away)).toBe(false);
    expect((await git({ args: ["init", "-q", join(workspace.out, "made")], cwd: workspace.out })).error).toBe(false);
    expect((await git({ args: ["clone", "-q", "--origin", "up", repo, join(workspace.out, "copy")], cwd: workspace.out })).error).toBe(false);
    expect((await git({ args: ["worktree", "add", "-q", join(workspace.out, "tree")], cwd: repo })).error).toBe(false);
  });

  it("refuses options that start a command, bundled, attached or abbreviated", async () => {
    for (const args of [
      ["rebase", "-x", `touch '${marker}'`, "HEAD"],
      ["rebase", `-xtouch '${marker}'`, "HEAD"],
      ["rebase", "-ix", "true", "HEAD"],
      ["grep", "-O", "a"],
      ["grep", `-Otouch '${marker}'`, "a"],
      ["grep", "--open-files-in-pager", "a"],
      ["clone", `-utouch '${marker}'`, repo, join(workspace.out, "u1")],
      ["clone", "-qu", `touch '${marker}'`, repo, join(workspace.out, "u2")],
      ["clone", "--reference", workspace.outside, repo, join(workspace.out, "r1")],
      ["init", "--template", workspace.out, join(workspace.out, "t1")],
    ]) {
      const cwd = args[0] === "clone" || args[0] === "init" ? workspace.out : repo;
      expect((await git({ args, cwd })).text, args.join(" ")).toContain("is not allowed");
    }
    // An abbreviated long option is refused by git itself.
    const abbreviated = await git({ args: ["clone", `--upload=touch '${marker}'`, repo, join(workspace.out, "u3")], cwd: workspace.out });
    expect(abbreviated.text).toContain("abbreviated");
    expect(existsSync(marker)).toBe(false);
  });

  it("cannot reach a repository's .git folder with write, so no filter driver can be set", async () => {
    const [write] = createTools(["write"], { cwd: workspace.src, searchDir: workspace.src, readOnly: [workspace.src], outDir: workspace.out, tmpDir: tmp, onOutput: () => undefined }) as unknown as [{ execute: (id: string, params: unknown) => Promise<unknown> }];
    const config = `[filter "probe"]\n\tclean = touch '${marker}'; cat\n`;
    await expect(write.execute("call", { path: "confined/.git/config", content: config })).rejects.toThrow(/\.git folder/);
    await write.execute("call", { path: "confined/.gitattributes", content: "*.txt filter=probe\n" });
    writeFileSync(join(repo, "b.txt"), "b\n");
    expect((await git({ args: ["add", "b.txt"], cwd: repo })).error).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("kernel git transports (T3-012)", () => {
  const work = join(workspace.out, "transports");
  const away = join(workspace.outside, "away.git");
  const inside = join(workspace.out, "inside.git");
  const awayUrl = `file:///${away.replaceAll("\\", "/").replace(/^\//, "")}`;
  const refs = (bare: string): string => execFileSync("git", ["for-each-ref", "--format=%(refname)"], { cwd: bare, encoding: "utf8" });

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", away]);
    execFileSync("git", ["init", "-q", "--bare", inside]);
    execFileSync("git", ["clone", "-q", workspace.src, work]);
    writeFileSync(join(work, "t.txt"), "t\n");
    execFileSync("git", ["add", "t.txt"], { cwd: work });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "t"], { cwd: work });
  });

  it("refuses to push into, fetch from or name as a remote a repository outside the workspace", async () => {
    for (const args of [
      ["push", away, "HEAD:refs/heads/planted"],
      ["push", awayUrl, "HEAD:refs/heads/planted"],
      ["push", "--repo", away, "HEAD:refs/heads/planted"],
      ["fetch", away],
      ["pull", awayUrl],
      ["remote", "add", "away", away],
      ["remote", "set-url", "origin", awayUrl],
      ["submodule", "add", away, "sub"],
    ]) {
      const { text } = await git({ args, cwd: work });
      expect(text, args.join(" ")).toMatch(/may not reach/);
    }
    expect(refs(away)).toBe("");
  });

  it("pushes only where the job may write, also through a named remote", async () => {
    // origin is the read-only checkout the clone came from: readable, not writable.
    expect((await git({ args: ["push", "origin", "HEAD:refs/heads/planted"], cwd: work })).text).toMatch(/may not reach/);
    expect((await git({ args: ["push"], cwd: work })).text).toMatch(/may not reach/);
    expect((await git({ args: ["remote", "add", "mine", inside], cwd: work })).error).toBe(false);
    const pushed = await git({ args: ["push", "-q", "mine", "HEAD:refs/heads/kept"], cwd: work });
    expect(pushed.error, pushed.text).toBe(false);
    expect(refs(inside)).toContain("refs/heads/kept");
    expect((await git({ args: ["fetch", "-q", "origin"], cwd: work })).error).toBe(false);
  });

  it("leaves remotes over the network alone", async () => {
    expect((await git({ args: ["remote", "add", "upstream", "https://example.invalid/team/repo.git"], cwd: work })).error).toBe(false);
    expect((await git({ args: ["remote", "set-url", "upstream", "git@example.invalid:team/repo.git"], cwd: work })).error).toBe(false);
  });
});

describe("kernel git option allowlist (P-031)", () => {
  const repo = join(workspace.out, "allowlist");

  beforeAll(() => {
    mkdirSync(tmp, { recursive: true });
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    execFileSync("git", ["add", "a.txt"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "one"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-am", "two"], { cwd: repo });
  });

  it("runs what the code-reviewer reads a merge request with", async () => {
    for (const args of [
      ["diff", "--stat", "HEAD~1", "HEAD"],
      ["diff", "--name-only", "HEAD~1"],
      ["log", "--oneline", "-5"],
      ["log", "-n", "1", "--format=%H %s"],
      ["show", "--stat", "HEAD"],
      ["blame", "-L", "1,2", "a.txt"],
      ["status", "--short"],
    ]) {
      const { text, error } = await git({ args, cwd: repo });
      expect(error, `${args.join(" ")}: ${text}`).toBe(false);
    }
  });

  it("refuses an option its subcommand does not list, naming it and the allowed ones", async () => {
    const { text } = await git({ args: ["log", "--output-indicator-new=x"], cwd: repo });
    expect(text).toContain('git option "--output-indicator-new=x" is not allowed for "git log" here');
    expect(text).toContain("allowed: -p, --patch");
    for (const args of [["status", "--find-renames"], ["blame", "-q", "a.txt"], ["commit", "-qz", "-m", "x"], ["tag", "--cleanup=verbatim", "t"]]) {
      expect((await git({ args, cwd: repo })).text, args.join(" ")).toMatch(/is not allowed for "git \w+" here/);
    }
  });

  it("reads an option's value as a value, and the paths after -- as paths", () => {
    expect(findUnlistedOption("log", ["-n", "5", "--format", "%s", "-3"])).toBeUndefined();
    expect(findUnlistedOption("commit", ["-qm", "-x is a message", "--author", "A <a@b>"])).toBeUndefined();
    expect(findUnlistedOption("diff", ["HEAD", "--", "--not-an-option"])).toBeUndefined();
    expect(findUnlistedOption("branch", ["-vv"])).toBeUndefined();
    expect(findUnlistedOption("worktree", ["add", "-q", "x"])).toBeUndefined();
    expect(findUnlistedOption("log", ["--follow", "--exec=x"])).toBe("--exec=x");
    expect(findUnlistedOption("pwn", ["-x"])).toBe("-x");
  });

  it("keeps the patch apply reads in the workspace", async () => {
    const { text } = await git({ args: ["apply", "--check", join(workspace.outside, "token.txt")], cwd: repo });
    expect(text).toContain("outside the job workspace");
    expect(text).not.toContain("TOP_SECRET_VALUE");
  });
});
