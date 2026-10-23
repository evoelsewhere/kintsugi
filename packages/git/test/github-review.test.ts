import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneMirror, fetchPullRequestRefs, listChangedPaths } from "../src/index.js";
import { startGitHttpServer, type GitHttpServer } from "../src/testing.js";

let fixture: GitHttpServer;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kintsugi-pr-review-git-"));
  fixture = await startGitHttpServer();
});

afterAll(async () => {
  await fixture.close();
  await rm(root, { recursive: true, force: true });
});

function options(url: string) {
  return { allowHttp: true, remoteUrl: url } as const;
}

async function repository(name: string, changedFiles: readonly { path: string; content: string }[] = [{ path: "src/change.ts", content: "export const changed = true;\n" }]) {
  await fixture.createRepository(name);
  const baseSha = fixture.git(name, "rev-parse", "refs/heads/main").trim();
  const headSha = await fixture.commitFiles(name, changedFiles, "feature");
  fixture.git(name, "update-ref", "refs/pull/17/head", headSha);
  const url = `${fixture.baseUrl}/${name}.git`;
  const mirror = join(root, `${name}.git`);
  await cloneMirror(url, mirror, options(url));
  return { baseSha, headSha, mirror, url };
}

describe("fixed GitHub pull request revisions", () => {
  it("fetches and verifies the observed head and base commits, then computes their merge base", async () => {
    const repo = await repository("fixed-revisions");

    const result = await fetchPullRequestRefs(repo.mirror, {
      number: 17,
      baseRef: "main",
      expectedHeadSha: repo.headSha,
      expectedBaseSha: repo.baseSha,
    }, options(repo.url));

    expect(result).toEqual({
      headSha: repo.headSha,
      baseSha: repo.baseSha,
      mergeBaseSha: repo.baseSha,
      headRef: expect.stringMatching(/^refs\/kintsugi\/reviews\/17\/[0-9a-f]{40}\/[0-9a-f]{40}\/head$/),
      baseRef: expect.stringMatching(/^refs\/kintsugi\/reviews\/17\/[0-9a-f]{40}\/[0-9a-f]{40}\/base$/),
    });
    await expect(listChangedPaths(repo.mirror, result.baseSha, result.headSha)).resolves.toEqual(["src/change.ts"]);
  });

  it("rejects a PR head that changed after the provider observation", async () => {
    const repo = await repository("stale-head");
    const staleHead = repo.headSha;
    const currentHead = await fixture.commit("stale-head", "src/change.ts", "export const changed = false;\n", "feature");
    fixture.git("stale-head", "update-ref", "refs/pull/17/head", currentHead);

    await expect(fetchPullRequestRefs(repo.mirror, {
      number: 17,
      baseRef: "main",
      expectedHeadSha: staleHead,
      expectedBaseSha: repo.baseSha,
    }, options(repo.url))).rejects.toThrow(/changed after observation/);
  });

  it("rejects unsafe PR numbers, refs and object ids before invoking Git", async () => {
    const repo = await repository("invalid-ref");
    await expect(fetchPullRequestRefs(repo.mirror, {
      number: 0,
      baseRef: "main",
      expectedHeadSha: repo.headSha,
      expectedBaseSha: repo.baseSha,
    }, options(repo.url))).rejects.toThrow(/positive integer/);
    await expect(fetchPullRequestRefs(repo.mirror, {
      number: 17,
      baseRef: "main:refs/heads/other",
      expectedHeadSha: repo.headSha,
      expectedBaseSha: repo.baseSha,
    }, options(repo.url))).rejects.toThrow(/invalid base branch/);
    await expect(fetchPullRequestRefs(repo.mirror, {
      number: 17,
      baseRef: "main",
      expectedHeadSha: "not-a-sha",
      expectedBaseSha: repo.baseSha,
    }, options(repo.url))).rejects.toThrow(/full commit id/);
  });

  it("enumerates every changed path from Git when the provider-sized cap is exceeded", async () => {
    const files = Array.from({ length: 3_001 }, (_, index) => ({
      path: `src/generated/file-${String(index).padStart(4, "0")}.ts`,
      content: `export const file${index} = ${index};\n`,
    }));
    const repo = await repository("large-diff", files);
    const refs = await fetchPullRequestRefs(repo.mirror, {
      number: 17,
      baseRef: "main",
      expectedHeadSha: repo.headSha,
      expectedBaseSha: repo.baseSha,
    }, options(repo.url));

    const changed = await listChangedPaths(repo.mirror, refs.baseSha, refs.headSha);
    expect(changed).toHaveLength(3_001);
    expect(changed[0]).toBe("src/generated/file-0000.ts");
    expect(changed.at(-1)).toBe("src/generated/file-3000.ts");
  }, 90_000);
});
