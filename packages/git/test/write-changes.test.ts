// Delete and rename entries of the writer (P2-027, ADR-0098): a file removed or moved in one commit with a
// compare-and-set on its hash, the rules that refuse a commit before a file is touched, and history that follows a move.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOT_NAME,
  CheckoutStorage,
  GitError,
  MAX_COMMIT_ENTRIES,
  addWorktree,
  cloneMirror,
  commitFiles,
  resolveCommit,
  writeFiles,
} from "../src/index.js";
import { type GitHttpServer, startGitHttpServer } from "../src/testing.js";

const remoteOptions = { allowHttp: true } as const;
const identity = { name: BOT_NAME, email: "kintsugi-bot@kintsugi.invalid" };
const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A page long enough that a few changed lines still look like the same file to Git's rename detection. */
const PAGE = Array.from({ length: 24 }, (_, line) => `Line ${line + 1} of the page: the batch computes the tax of an invoice line.`).join("\n") + "\n";

let server: GitHttpServer;
let root: string;
let storage: CheckoutStorage;
let counter = 0;

beforeAll(async () => {
  server = await startGitHttpServer();
  root = await mkdtemp(join(tmpdir(), "kintsugi-git-changes-"));
  storage = new CheckoutStorage(root);
  await storage.prepare();
});
afterAll(async () => {
  await server?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

/** A repository with `files` at its head and two earlier commits of `old/page.md`, mirrored, with a worktree at the head. */
async function repository(files: Record<string, string> = {}) {
  const name = `changes-${(counter += 1)}`;
  await server.createRepository(name);
  await server.commit(name, "old/page.md", "first version\n");
  await server.commit(name, "old/page.md", PAGE.replace("Line 1 ", "Line one "));
  await server.commitFiles(name, [{ path: "old/page.md", content: PAGE }, { path: "keep.md", content: "keep\n" }, ...Object.entries(files).map(([path, content]) => ({ path, content }))]);
  const url = `${server.baseUrl}/${name}.git`;
  const mirror = storage.mirror("local", name);
  await cloneMirror(url, mirror, { ...remoteOptions, partial: true });
  const worktree = join(root, `${name}-worktree`);
  await addWorktree(mirror, worktree, await resolveCommit(mirror, "refs/heads/main"), remoteOptions);
  const git = (...args: string[]): string => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" });
  return { name, url, mirror, worktree, git };
}

describe("deleting a file", () => {
  it("removes it in one commit when the hash is the file's, and keeps no empty folder", async () => {
    const { worktree, git } = await repository({ "gone/deep/only.md": "only\n" });
    const commit = await commitFiles(worktree, { identity, message: "Delete a page", files: [{ path: "gone/deep/only.md", delete: true, expectedHash: hashOf("only\n") }] }, remoteOptions);
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git("show", "--name-status", "--format=", "HEAD").trim()).toBe("D\tgone/deep/only.md");
    expect(existsSync(join(worktree, "gone"))).toBe(false);
    expect(existsSync(join(worktree, "keep.md"))).toBe(true);
  });

  it("fails with the hash error, and commits nothing, for another hash or a file that is gone", async () => {
    const { worktree, git } = await repository({ "gone/only.md": "only\n" });
    const head = git("rev-parse", "HEAD").trim();
    await expect(commitFiles(worktree, { identity, message: "x", files: [{ path: "gone/only.md", delete: true, expectedHash: hashOf("something else") }] }, remoteOptions)).rejects.toThrow(/changed since it was read/);
    await expect(commitFiles(worktree, { identity, message: "x", files: [{ path: "gone/missing.md", delete: true, expectedHash: hashOf("only\n") }] }, remoteOptions)).rejects.toThrow(/changed since it was read/);
    await expect(commitFiles(worktree, { identity, message: "x", files: [{ path: "gone/only.md", delete: true, expectedHash: "nothex" }] }, remoteOptions)).rejects.toThrow(/Invalid expected document hash/);
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
    expect(await readFile(join(worktree, "gone/only.md"), "utf8")).toBe("only\n");
  });

  it("is pushed by the writer's one call and gone from the remote", async () => {
    const { name, url, mirror } = await repository({ "gone/only.md": "only\n" });
    const result = await writeFiles(
      { url, mirrorPath: mirror, worktree: storage.workspace(name), defaultBranch: "main", branch: "main", message: "Delete a page", identity, files: [{ path: "gone/only.md", delete: true, expectedHash: hashOf("only\n") }] },
      remoteOptions,
    );
    expect(result).toMatchObject({ changed: true });
    expect(() => server.git(name, "show", "main:gone/only.md")).toThrow();
    expect(server.git(name, "show", "main:keep.md")).toBe("keep\n");
  });
});

describe("moving a file", () => {
  it("is one commit that adds the new path and removes the old, and history follows an exact move", async () => {
    const { worktree, git } = await repository();
    await commitFiles(worktree, { identity, message: "Move a page", files: [{ path: "new/page.md", renameFrom: "old/page.md", content: PAGE, expectedHash: hashOf(PAGE) }] }, remoteOptions);
    expect(git("show", "--name-status", "-M", "--format=", "HEAD").trim()).toMatch(/^R100\told\/page\.md\tnew\/page\.md$/);
    expect(existsSync(join(worktree, "old"))).toBe(false);
    // The earlier versions are listed through the move.
    expect(git("log", "--follow", "--format=%s", "--", "new/page.md").trim().split("\n")).toHaveLength(4);
  });

  it("is followed by history when the text changed a little in the move", async () => {
    const { worktree, git } = await repository();
    const edited = PAGE.replace("Line 3 of the page", "Line three of the page").replace("Line 9 of the page", "Line nine of the page");
    await commitFiles(worktree, { identity, message: "Move and rewrite a link", files: [{ path: "new/page.md", renameFrom: "old/page.md", content: edited, expectedHash: hashOf(PAGE) }] }, remoteOptions);
    expect(git("show", "--name-status", "-M", "--format=", "HEAD").trim()).toMatch(/^R\d+\told\/page\.md\tnew\/page\.md$/);
    expect(git("log", "--follow", "--format=%s", "--", "new/page.md").trim().split("\n").length).toBeGreaterThanOrEqual(4);
    expect(await readFile(join(worktree, "new/page.md"), "utf8")).toBe(edited);
  });

  it("fails on a source that changed since it was read, and writes nothing", async () => {
    const { worktree, git } = await repository();
    const head = git("rev-parse", "HEAD").trim();
    await expect(
      commitFiles(worktree, { identity, message: "x", files: [{ path: "new/page.md", renameFrom: "old/page.md", content: PAGE, expectedHash: hashOf("not the page") }] }, remoteOptions),
    ).rejects.toThrow(/changed since it was read/);
    await expect(
      commitFiles(worktree, { identity, message: "x", files: [{ path: "new/page.md", renameFrom: "old/missing.md", content: PAGE, expectedHash: hashOf(PAGE) }] }, remoteOptions),
    ).rejects.toThrow(/changed since it was read/);
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
    expect(existsSync(join(worktree, "new"))).toBe(false);
    expect(existsSync(join(worktree, "old/page.md"))).toBe(true);
  });

  it("is idempotent: the same move again, after it was made, commits nothing", async () => {
    const { worktree } = await repository();
    const input = { identity, message: "Move a page", files: [{ path: "new/page.md", renameFrom: "old/page.md", content: PAGE, expectedHash: hashOf(PAGE) }] };
    expect(await commitFiles(worktree, input, remoteOptions)).toMatch(/^[0-9a-f]{40}$/);
    expect(await commitFiles(worktree, input, remoteOptions)).toBeUndefined();
  });

  it("is pushed by the writer's one call, and the remote history follows the page", async () => {
    const { name, url, mirror } = await repository();
    await writeFiles(
      { url, mirrorPath: mirror, worktree: storage.workspace(name), defaultBranch: "main", branch: "main", message: "Move a page", identity, files: [{ path: "new/page.md", renameFrom: "old/page.md", content: PAGE, expectedHash: hashOf(PAGE) }] },
      remoteOptions,
    );
    expect(() => server.git(name, "show", "main:old/page.md")).toThrow();
    expect(server.git(name, "log", "--follow", "--format=%s", "main", "--", "new/page.md").trim().split("\n")).toHaveLength(4);
  });
});

describe("what a commit refuses before it touches a file", () => {
  const move = (path: string, renameFrom: string, content = PAGE) => ({ path, renameFrom, content, expectedHash: hashOf(PAGE) });

  it.each([
    ["two entries for one path", (): never[] | unknown[] => [{ path: "a.md", content: "1" }, { path: "a.md", content: "2" }], /appears twice/],
    ["a move onto itself", () => [move("old/page.md", "old/page.md")], /onto itself/],
    ["a move onto a different file that is already there", () => [move("keep.md", "old/page.md")], /different document is already there/],
    ["a move out of a path another entry writes", () => [move("new/page.md", "old/page.md"), { path: "old/page.md", content: "again" }], /another entry writes to it/],
    ["one file moved twice", () => [move("one.md", "old/page.md"), move("two.md", "old/page.md")], /removed twice/],
    ["a delete and a move of one file", () => [move("one.md", "old/page.md"), { path: "old/page.md", delete: true, expectedHash: hashOf(PAGE) }], /appears twice|removed twice|another entry writes/],
    ["an unsafe target", () => [move("../outside.md", "old/page.md")], /Invalid repository path/],
    ["an unsafe source", () => [move("new/page.md", "old/../../page.md")], /Invalid repository path/],
    ["a path inside .git", () => [{ path: ".git/config", delete: true, expectedHash: hashOf("x") }], /Invalid repository path/],
  ])("refuses %s", async (_name, entries, message) => {
    const { worktree, git } = await repository();
    const head = git("rev-parse", "HEAD").trim();
    const files = [{ path: "untouched.md", content: "must not be written" }, ...(entries() as never[])];
    await expect(commitFiles(worktree, { identity, message: "x", files }, remoteOptions)).rejects.toThrow(message);
    expect(existsSync(join(worktree, "untouched.md"))).toBe(false);
    expect(existsSync(join(worktree, "old/page.md"))).toBe(true);
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
  });

  it("refuses more than the most entries a commit may carry, deletes and moves counted", async () => {
    const { worktree } = await repository();
    const many = Array.from({ length: MAX_COMMIT_ENTRIES + 1 }, (_, n) => ({ path: `many/p${n}.md`, content: "x" }));
    await expect(commitFiles(worktree, { identity, message: "x", files: many }, remoteOptions)).rejects.toThrow(/at most 500 entries/);
    const fits = Array.from({ length: MAX_COMMIT_ENTRIES }, (_, n) => ({ path: `many/p${n}.md`, content: "x" }));
    expect(await commitFiles(worktree, { identity, message: "x", files: fits }, remoteOptions)).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses more than 50 MiB of content, and nothing is written", async () => {
    const { worktree } = await repository();
    const big = new Uint8Array(26 * 1024 * 1024);
    await expect(commitFiles(worktree, { identity, message: "x", files: [{ path: "a.bin", content: big }, { path: "b.bin", content: big }] }, remoteOptions)).rejects.toThrow(/at most 50 MiB/);
    expect(existsSync(join(worktree, "a.bin"))).toBe(false);
  });

  it("still writes binary content and a plain edit with its hash, as before", async () => {
    const { worktree, git } = await repository();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    await commitFiles(worktree, { identity, message: "Attach and edit", files: [{ path: "old/_attachments/a.png", content: png }, { path: "keep.md", content: "kept\n", expectedHash: hashOf("keep\n") }] }, remoteOptions);
    expect([...(await readFile(join(worktree, "old/_attachments/a.png")))]).toEqual([...png]);
    expect(git("show", "--format=", "--name-status", "HEAD").trim().split("\n").sort()).toEqual(["A\told/_attachments/a.png", "M\tkeep.md"]);
    expect(new GitError("x", null, "")).toBeInstanceOf(Error);
  });
});
