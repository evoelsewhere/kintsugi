// packages/git against real local repositories (file:// is allowed in tests only).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CheckoutStorage,
  GitError,
  addWorktree,
  assertSafeRemoteUrl,
  checkGitVersion,
  cloneMirror,
  dataDirFromEnv,
  fetchMirror,
  lsRemote,
  parseGitVersion,
  prefetchDocumentBlobs,
  removeWorktree,
  isAncestor,
  resolveCommit,
  runGit,
  stepFolder,
  worktreeIsAt,
} from "../src/index.js";

const local = { allowFileProtocol: true } as const;

let root: string;
let origin: string;
let originUrl: string;

/** Plain git for test fixtures only (the code under test goes through runGit). */
function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
}

async function commitFile(name: string, content: string): Promise<string> {
  await writeFile(join(origin, name), content);
  fixtureGit(origin, "add", name);
  fixtureGit(origin, "commit", "-q", "-m", `write ${name}`);
  return fixtureGit(origin, "rev-parse", "HEAD");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kintsugi-git-test-"));
  origin = join(root, "origin");
  await mkdir(origin);
  fixtureGit(origin, "init", "-q", "-b", "main");
  originUrl = pathToFileURL(origin).href;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("git version", () => {
  it("parses release and platform builds", () => {
    expect(parseGitVersion("git version 2.54.0.windows.1")).toEqual([2, 54, 0]);
    expect(parseGitVersion("git version 2.43.0\n")).toEqual([2, 43, 0]);
    expect(parseGitVersion("not git")).toBeUndefined();
  });

  it("accepts the installed git", async () => {
    await expect(checkGitVersion()).resolves.toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("remote URLs", () => {
  it("rejects credentials in URLs and option-like values", () => {
    expect(() => assertSafeRemoteUrl("https://user:token@git.example.com/org/repo.git")).toThrow(GitError);
    expect(() => assertSafeRemoteUrl("https://token@git.example.com/org/repo.git")).toThrow(GitError);
    expect(() => assertSafeRemoteUrl("--upload-pack=touch /tmp/x")).toThrow(GitError);
    expect(() => assertSafeRemoteUrl("https://git.example.com/org/repo.git")).not.toThrow();
    expect(() => assertSafeRemoteUrl("git@git.example.com:org/repo.git")).not.toThrow();
  });

  it("refuses the file protocol unless allowed", async () => {
    await commitFile("README.md", "v1\n");
    await expect(lsRemote(originUrl)).rejects.toThrow(GitError);
    await expect(lsRemote(originUrl, local)).resolves.toMatchObject({ defaultBranch: "main" });
  });
});

describe("mirror and job worktrees", () => {
  it("probes, mirrors, fetches and checks out fixed commits", async () => {
    const first = fixtureGit(origin, "rev-parse", "HEAD");
    const info = await lsRemote(originUrl, local);
    expect(info).toEqual({ defaultBranch: "main", branches: [{ name: "main", commit: first }] });

    const storage = new CheckoutStorage(join(root, "data"));
    await storage.prepare();
    const mirror = storage.mirror("local", "app");
    await cloneMirror(originUrl, mirror, { ...local, partial: true });
    expect(await resolveCommit(mirror, "main")).toBe(first);
    await expect(cloneMirror(originUrl, mirror, local)).rejects.toThrow(/already exists/);

    // A new upstream commit reaches the mirror; the old job keeps its snapshot.
    const job1 = storage.job("job-1");
    await addWorktree(mirror, job1.asIs, first, local);
    const second = await commitFile("README.md", "v2\n");
    await fetchMirror(mirror, local);
    expect(await resolveCommit(mirror, "main")).toBe(second);
    // Ancestry: the older commit is in main, the newer one is not in the older one.
    expect(await isAncestor(mirror, first, "main")).toBe(true);
    expect(await isAncestor(mirror, second, first)).toBe(false);
    await expect(isAncestor(mirror, "0".repeat(40), "main")).rejects.toThrow();

    const job2 = storage.job("job-2");
    await addWorktree(mirror, job2.asIs, second, local);
    expect(await readFile(join(job1.asIs, "README.md"), "utf8")).toBe("v1\n");
    expect(await readFile(join(job2.asIs, "README.md"), "utf8")).toBe("v2\n");

    await removeWorktree(mirror, job1.asIs);
    expect(existsSync(job1.asIs)).toBe(false);
    await removeWorktree(mirror, job2.asIs);
  });

  it("tells whether a worktree is still the pinned commit with nothing changed", async () => {
    const storage = new CheckoutStorage(join(root, "data"));
    const mirror = storage.mirror("local", "app");
    const commit = await resolveCommit(mirror, "main");
    const job = storage.job("job-reuse");
    expect(await worktreeIsAt(job.asIs, commit)).toBe(false);
    await addWorktree(mirror, job.asIs, commit, local);
    expect(await worktreeIsAt(job.asIs, commit)).toBe(true);
    expect(await worktreeIsAt(job.asIs, "0".repeat(40))).toBe(false);
    await writeFile(join(job.asIs, "README.md"), "changed\n");
    expect(await worktreeIsAt(job.asIs, commit)).toBe(false);
    await writeFile(join(job.asIs, "README.md"), "v2\n");
    await writeFile(join(job.asIs, "stray.txt"), "x\n");
    expect(await worktreeIsAt(job.asIs, commit)).toBe(false);
    await removeWorktree(mirror, job.asIs);
  });

  it("prefetches the document blobs a credential-less reader needs, and no code", async () => {
    const source = join(root, "partial-origin");
    await mkdir(source);
    fixtureGit(source, "init", "-q", "-b", "main");
    fixtureGit(source, "config", "uploadpack.allowFilter", "true");
    fixtureGit(source, "config", "uploadpack.allowAnySHA1InWant", "true");
    const write = async (name: string, content: string): Promise<void> => {
      await mkdir(join(source, name, ".."), { recursive: true });
      await writeFile(join(source, name), content);
    };
    await write("docs/a.md", "a\n");
    await write("src/old.cbl", "old\n");
    fixtureGit(source, "add", ".");
    fixtureGit(source, "commit", "-q", "-m", "first");

    const storage = new CheckoutStorage(join(root, "data"));
    const mirror = storage.mirror("local", "partial");
    const sourceUrl = pathToFileURL(source).href;
    await cloneMirror(sourceUrl, mirror, { ...local, partial: true });
    await write("docs/b.md", "b\n");
    await write("src/new.cbl", "new\n");
    fixtureGit(source, "add", ".");
    fixtureGit(source, "commit", "-q", "-m", "second");
    await fetchMirror(mirror, local);
    const tip = await resolveCommit(mirror, "main");

    // A reader has no credential and may not reach the remote: a blob the mirror lacks is an error.
    const read = (path: string) => runGit(["--git-dir", mirror, "cat-file", "blob", `${tip}:${path}`]);
    await expect(read("docs/b.md")).rejects.toThrow(GitError);

    expect(await prefetchDocumentBlobs(mirror, tip, local)).toBe(2);
    expect((await read("docs/b.md")).stdout).toBe("b\n");
    expect((await read("docs/a.md")).stdout).toBe("a\n");
    await expect(read("src/new.cbl")).rejects.toThrow(GitError);
    expect(await prefetchDocumentBlobs(mirror, tip, local)).toBe(0);
  });

  it("only checks out full commit ids", async () => {
    const storage = new CheckoutStorage(join(root, "data"));
    await expect(addWorktree(storage.mirror("local", "app"), storage.job("job-3").asIs, "main", local)).rejects.toThrow(/full commit id/);
  });

  it("never runs repository hooks", async () => {
    const storage = new CheckoutStorage(join(root, "data"));
    const mirror = storage.mirror("local", "app");
    const marker = join(root, "hook-ran");
    await writeFile(join(mirror, "hooks", "post-checkout"), `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\n`, { mode: 0o755 });
    const job = storage.job("job-hooks");
    await addWorktree(mirror, job.asIs, await resolveCommit(mirror, "main"), local);
    expect(existsSync(marker)).toBe(false);
    await removeWorktree(mirror, job.asIs);
  });
});

describe("credentials", () => {
  const token = "ghp_TEST-token-0123456789abcdef";

  it("hands a token to git through the per-call credential helper", async () => {
    const { stdout } = await runGit(["credential", "fill"], {
      credential: { kind: "token", token, username: "bot" },
      input: "protocol=https\nhost=git.example.invalid\n\n",
    });
    expect(stdout).toContain("username=bot");
    expect(stdout).toContain(`password=${token}`);
  });

  it("does not leak the token in errors", async () => {
    const error = await lsRemote("https://127.0.0.1:9/org/repo.git", { credential: { kind: "token", token }, timeoutMs: 20_000 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GitError);
    expect(`${(error as GitError).message}\n${(error as GitError).stderr}`).not.toContain(token);
  });

  it("never sends credentials over plain http", async () => {
    await expect(lsRemote("http://git.example.invalid/org/repo.git", { credential: { kind: "token", token }, allowHttp: true })).rejects.toThrow(
      /plain http/,
    );
  });

  it("requires pinned host keys for SSH keys", async () => {
    await expect(lsRemote("git@git.example.invalid:org/repo.git", { credential: { kind: "ssh-key", privateKey: "key" } })).rejects.toThrow(
      /knownHosts/,
    );
  });
});

describe("checkout storage", () => {
  it("keeps ids inside the data directory", () => {
    const storage = new CheckoutStorage(join(root, "data"));
    expect(() => storage.mirror("..", "app")).toThrow(/Invalid server id/);
    expect(() => storage.mirror("srv", "a/b")).toThrow(/Invalid repository id/);
    expect(() => storage.job("../../etc")).toThrow(/Invalid job id/);
    expect(() => new CheckoutStorage("relative/path")).toThrow(/absolute/);
  });

  it("lays a job workspace out in zones, with a safe folder for every step key", () => {
    const storage = new CheckoutStorage(join(root, "data"));
    const job = storage.job("job-1");
    expect(job.asIs).toBe(join(job.root, "as-is"));
    expect(job.toBe).toBe(join(job.root, "to-be"));
    expect(job.ledger).toBe(join(job.root, ".state", "ledger.json"));
    const step = job.step("design-unit#billing/invoice@2");
    expect(step.root.startsWith(job.steps)).toBe(true);
    expect(step.in).toBe(join(step.root, "in"));
    expect(step.out).toBe(join(step.root, "out"));
    expect(step.tmp).toBe(join(step.root, "tmp"));
    expect(stepFolder("design-unit#billing/invoice@2")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(stepFolder("a#b")).not.toBe(stepFolder("a-b"));
    expect(stepFolder("../../etc")).toMatch(/^etc-[0-9a-f]{8}$/);
    expect(job.step("same").root).toBe(job.step("same").root);
  });

  it("defaults to .kintsugi/data without KINTSUGI_DATA_DIR", () => {
    expect(dataDirFromEnv({}, root)).toBe(join(root, ".kintsugi", "data"));
    expect(dataDirFromEnv({ KINTSUGI_DATA_DIR: join(root, "srv") }, root)).toBe(join(root, "srv"));
  });
});
