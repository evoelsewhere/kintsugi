// The write side against a local smart-HTTP server (pushes over anonymous http, tests only):
// commits with trailers, protected refs, path rules, fetch → rebase → retry, conflicts.

import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOT_NAME,
  CheckoutStorage,
  GitError,
  addWorktree,
  assertSafeRepoPath,
  assertWritableBranch,
  cloneMirror,
  commitFiles,
  commitMessage,
  fetchMirror,
  pushWithRebase,
  resolveCommit,
  writeFiles,
} from "../src/index.js";
import { type GitHttpServer, startGitHttpServer } from "../src/testing.js";

const remoteOptions = { allowHttp: true } as const;
const identity = { name: BOT_NAME, email: "kintsugi-bot@kintsugi.invalid" };

let server: GitHttpServer;
let root: string;
let storage: CheckoutStorage;

beforeAll(async () => {
  server = await startGitHttpServer();
  root = await mkdtemp(join(tmpdir(), "kintsugi-git-write-"));
  storage = new CheckoutStorage(root);
  await storage.prepare();
});
afterAll(async () => {
  await server?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function mirrorOf(name: string): Promise<{ url: string; mirror: string }> {
  await server.createRepository(name);
  const url = `${server.baseUrl}/${name}.git`;
  const mirror = storage.mirror("local", name);
  await cloneMirror(url, mirror, { ...remoteOptions, partial: true });
  return { url, mirror };
}

describe("path and ref rules", () => {
  it("accepts relative repository paths only", () => {
    expect(assertSafeRepoPath("units/web/login.md")).toBe("units/web/login.md");
    for (const bad of ["", "/etc/passwd", "C:/x", "a/../b", "./a", "a//b", ".git/config", "a/.GIT/hooks/x", "a\\b", "a\nb"]) {
      expect(() => assertSafeRepoPath(bad), bad).toThrow(GitError);
    }
  });

  it("writes only to the default branch and kintsugi/* branches", async () => {
    await expect(assertWritableBranch("main", "main")).resolves.toBeUndefined();
    await expect(assertWritableBranch("kintsugi/legacy-analyst/job-1", "main")).resolves.toBeUndefined();
    for (const bad of ["release", "refs/tags/v1", "kintsugi/../main", "kintsugi/a..b", "kintsugi/x.lock", "-f", "kintsugi/a b"]) {
      await expect(assertWritableBranch(bad, "main"), bad).rejects.toThrow(GitError);
    }
  });

  it("renders the message with one trailer paragraph and rejects multi-line values", () => {
    expect(commitMessage("Publish kintsugi.yaml\n", [{ key: "Kintsugi-Actor", value: "alice" }])).toBe("Publish kintsugi.yaml\n\nKintsugi-Actor: alice\n");
    expect(() => commitMessage("x", [{ key: "Kintsugi-Job", value: "a\nEvil: b" }])).toThrow(GitError);
    expect(() => commitMessage("x", [{ key: "Bad Key", value: "v" }])).toThrow(GitError);
    expect(() => commitMessage("  ")).toThrow(GitError);
  });
});

describe("writeFiles", () => {
  it("commits as kintsugi-bot with trailers on a new kintsugi/* branch", async () => {
    const { url, mirror } = await mirrorOf("docs-branch");
    const result = await writeFiles(
      {
        url,
        mirrorPath: mirror,
        worktree: storage.workspace("docs-branch"),
        defaultBranch: "main",
        branch: "kintsugi/alice/w-1",
        files: [{ path: "kintsugi.yaml", content: "schemaVersion: 1\n" }],
        message: "Publish kintsugi.yaml",
        identity,
        trailers: [
          { key: "Kintsugi-Job", value: "w-1" },
          { key: "Kintsugi-Actor", value: "alice" },
        ],
      },
      remoteOptions,
    );
    expect(result).toMatchObject({ branch: "kintsugi/alice/w-1", changed: true, attempts: 1 });
    expect(server.git("docs-branch", "show", "kintsugi/alice/w-1:kintsugi.yaml")).toBe("schemaVersion: 1\n");
    expect(server.git("docs-branch", "log", "-1", "--format=%an <%ae>|%cn", "kintsugi/alice/w-1").trim()).toBe(`${BOT_NAME} <${identity.email}>|${BOT_NAME}`);
    expect(server.git("docs-branch", "log", "-1", "--format=%(trailers:only,unfold)", "kintsugi/alice/w-1").trim()).toBe("Kintsugi-Job: w-1\nKintsugi-Actor: alice");
    // main is untouched and the scratch worktree is gone.
    expect(() => server.git("docs-branch", "show", "main:kintsugi.yaml")).toThrow();
    expect(existsSync(storage.workspace("docs-branch"))).toBe(false);
  });

  it("reports unchanged files without committing", async () => {
    const { url, mirror } = await mirrorOf("docs-same");
    const before = server.git("docs-same", "rev-parse", "main").trim();
    const result = await writeFiles(
      { url, mirrorPath: mirror, worktree: storage.workspace("docs-same"), defaultBranch: "main", branch: "main", files: [{ path: "README.md", content: "docs-same\n" }], message: "No-op", identity },
      remoteOptions,
    );
    expect(result).toEqual({ branch: "main", commit: before, changed: false, attempts: 0 });
    expect(server.git("docs-same", "rev-parse", "main").trim()).toBe(before);
  });

  it("rebases onto a concurrent push and retries (fast-forward only)", async () => {
    const { url, mirror } = await mirrorOf("docs-race");
    const worktree = storage.workspace("docs-race");
    await addWorktree(mirror, worktree, await resolveCommit(mirror, "refs/heads/main"), remoteOptions);
    await commitFiles(worktree, { files: [{ path: "units/web/a.md", content: "a\n" }], message: "Update unit a", identity }, remoteOptions);
    // Someone else pushes to main after our worktree was created.
    const theirs = await server.commit("docs-race", "units-b.md", "b\n");
    const pushed = await pushWithRebase(worktree, { url, mirrorPath: mirror, branch: "main", defaultBranch: "main", identity }, remoteOptions);
    expect(pushed.attempts).toBe(2);
    expect(server.git("docs-race", "rev-parse", "main").trim()).toBe(pushed.commit);
    expect(server.git("docs-race", "rev-parse", "main~1").trim()).toBe(theirs);
    expect(server.git("docs-race", "show", "main:units/web/a.md")).toBe("a\n");
  });

  it("fails on a conflicting concurrent change and gives up after maxAttempts", async () => {
    const { url, mirror } = await mirrorOf("docs-conflict");
    const worktree = storage.workspace("docs-conflict");
    await addWorktree(mirror, worktree, await resolveCommit(mirror, "refs/heads/main"), remoteOptions);
    await commitFiles(worktree, { files: [{ path: "README.md", content: "ours\n" }], message: "Ours", identity }, remoteOptions);
    await server.commit("docs-conflict", "README.md", "theirs\n");
    await expect(pushWithRebase(worktree, { url, mirrorPath: mirror, branch: "main", defaultBranch: "main", identity }, remoteOptions)).rejects.toThrow(/conflicting change/);
    // One attempt only: the rejection is returned as is, nothing is forced.
    await expect(pushWithRebase(worktree, { url, mirrorPath: mirror, branch: "main", defaultBranch: "main", identity, maxAttempts: 1 }, remoteOptions)).rejects.toThrow(/rejected|failed/);
    await fetchMirror(mirror, remoteOptions);
    expect(server.git("docs-conflict", "show", "main:README.md")).toBe("theirs\n");
  });

  it("refuses protected refs and paths before touching the repository", async () => {
    const { url, mirror } = await mirrorOf("docs-guard");
    const base = { url, mirrorPath: mirror, worktree: storage.workspace("docs-guard"), defaultBranch: "main", message: "x", identity };
    await expect(writeFiles({ ...base, branch: "release", files: [{ path: "a.md", content: "a" }] }, remoteOptions)).rejects.toThrow(/Refusing/);
    await expect(writeFiles({ ...base, branch: "main", files: [{ path: "../a.md", content: "a" }] }, remoteOptions)).rejects.toThrow(/Invalid repository path/);
    await expect(writeFiles({ ...base, branch: "main", files: [{ path: ".git/hooks/post-commit", content: "a" }] }, remoteOptions)).rejects.toThrow(/Invalid repository path/);
  });

  it.skipIf(process.platform === "win32")("never writes through a symbolic link in the worktree", async () => {
    const { mirror } = await mirrorOf("docs-link");
    const worktree = storage.workspace("docs-link");
    await addWorktree(mirror, worktree, await resolveCommit(mirror, "refs/heads/main"), remoteOptions);
    await symlink(root, join(worktree, "units"));
    await expect(commitFiles(worktree, { files: [{ path: "units/x.md", content: "x" }], message: "x", identity }, remoteOptions)).rejects.toThrow(/symbolic link/);
  });
});
