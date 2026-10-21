import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckoutStorage, cloneMirror, type ObservedPullRequest } from "@kintsugi/git";
import { startGitHttpServer, type GitHttpServer } from "@kintsugi/git/testing";
import { materializeReviewInput, type ReviewContextSnapshot } from "../src/member-reviews/inputs.js";

let fixture: GitHttpServer;
let root: string;
let storage: CheckoutStorage;
let codeHead: string;
let codeBase: string;
let docsCommit: string;
const codeRepositoryId = "review-code";
const docsRepositoryId = "review-docs";
const design = "# Approved design\n\nTax rounding uses decimal arithmetic.\n";
const designPath = "applications/billing/units/tax/design.md";
const taskPack = "# Tax task\n\n## Objective\nUse decimal arithmetic.\n\n## Acceptance criteria\n- Round half up\n2. Keep the API stable\n";
const taskPackPath = "applications/billing/units/tax/task.md";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kintsugi-review-inputs-"));
  fixture = await startGitHttpServer();
  storage = new CheckoutStorage(join(root, "data"));
  await storage.prepare();

  await fixture.createRepository(codeRepositoryId);
  codeBase = fixture.git(codeRepositoryId, "rev-parse", "refs/heads/main").trim();
  codeHead = await fixture.commitFiles(codeRepositoryId, [{ path: "src/tax.ts", content: "export const round = (n: number) => Math.round(n);\n" }], "feature/tax");
  fixture.git(codeRepositoryId, "update-ref", "refs/pull/17/head", codeHead);
  await cloneMirror(`${fixture.baseUrl}/${codeRepositoryId}.git`, storage.mirror("local", codeRepositoryId), {
    allowHttp: true,
    remoteUrl: `${fixture.baseUrl}/${codeRepositoryId}.git`,
  });

  await fixture.createRepository(docsRepositoryId);
  await fixture.commitFiles(docsRepositoryId, [
    { path: designPath, content: design },
    { path: taskPackPath, content: taskPack },
  ]);
  docsCommit = fixture.git(docsRepositoryId, "rev-parse", "refs/heads/main").trim();
  await cloneMirror(`${fixture.baseUrl}/${docsRepositoryId}.git`, storage.mirror("local", docsRepositoryId), {
    allowHttp: true,
    remoteUrl: `${fixture.baseUrl}/${docsRepositoryId}.git`,
  });
});

afterAll(async () => {
  await fixture.close();
  await rm(root, { recursive: true, force: true });
});

const sha256 = (content: string): string => `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

function observedPullRequest(): ObservedPullRequest {
  return {
    provider: "github",
    host: "github.com",
    repositoryId: "provider-repo-42",
    repositoryPath: "Acme/Billing",
    pullRequestId: "17",
    number: 17,
    htmlUrl: "https://github.com/Acme/Billing/pull/17",
    associationClaimStatus: "absent",
    state: "open",
    draft: false,
    updatedAt: "2026-10-21T10:00:00.000Z",
    headSha: codeHead,
    headRef: "feature/tax",
    baseSha: codeBase,
    baseRef: "main",
    reviews: [],
    checks: [],
  };
}

function snapshot(overrides: Partial<ReviewContextSnapshot> = {}): ReviewContextSnapshot {
  return {
    snapshotId: "ctx_0199abc0-1234-7123-8123-123456789abc",
    projectId: "billing",
    unitId: "billing/tax/calculate",
    contextRevision: `sha256:${"1".repeat(64)}`,
    policyRevision: "review-policy-v1",
    implementationRepositoryId: codeRepositoryId,
    task: {
      title: "Correct tax rounding",
      requiredDeliverableIds: ["code:billing/tax"],
    },
    sources: [
      {
        sourceId: "source_design",
        role: "detailed-design",
        repositoryId: docsRepositoryId,
        path: designPath,
        commit: docsCommit,
        contentHash: sha256(design),
        availability: "present",
        publication: "published",
        approval: "approved",
        required: true,
        readable: true,
      },
      {
        sourceId: "source_taskpack",
        role: "task-pack",
        repositoryId: docsRepositoryId,
        path: taskPackPath,
        commit: docsCommit,
        contentHash: sha256(taskPack),
        availability: "present",
        publication: "published",
        approval: "approved",
        required: true,
        readable: true,
      },
    ],
    ...overrides,
  };
}

function dependencies() {
  const targets = new Map([
    [codeRepositoryId, { id: codeRepositoryId, serverId: "local", url: `${fixture.baseUrl}/${codeRepositoryId}.git`, credential: { kind: "none" as const } }],
    [docsRepositoryId, { id: docsRepositoryId, serverId: "local", url: `${fixture.baseUrl}/${docsRepositoryId}.git`, credential: { kind: "none" as const } }],
  ]);
  return {
    storage,
    repositories: { target: async (repositoryId: string) => targets.get(repositoryId) },
  };
}

describe("fixed review input materialization", () => {
  it("pins PR revisions, complete Git diff and approved snapshot documents into read-only inputs", async () => {
    const jobRunId = "review-input-complete";
    const manifest = await materializeReviewInput(dependencies(), observedPullRequest(), snapshot(), jobRunId);
    const inputDir = storage.job(jobRunId).in;
    const input = JSON.parse(await readFile(join(inputDir, "review-input.json"), "utf8")) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      headSha: codeHead,
      baseSha: codeBase,
      mergeBaseSha: codeBase,
      changedFileCount: 1,
      changedFiles: [{ path: "src/tax.ts", mode: { old: "000000", next: "100644" } }],
      task: {
        title: "Correct tax rounding",
        objective: "Use decimal arithmetic.",
        acceptanceCriteria: ["Round half up", "Keep the API stable"],
      },
      coverage: { status: "complete", generatedFiles: 0, binaryFiles: 0, excludedFiles: [] },
    });
    expect(input).toMatchObject({
      contextRevision: snapshot().contextRevision,
      task: { title: "Correct tax rounding", objective: "Use decimal arithmetic." },
    });
    expect(input).not.toHaveProperty("sourceContent");
    expect(await readFile(join(inputDir, manifest.patchPath!), "utf8")).toContain("Math.round");
    expect(await readFile(join(inputDir, manifest.sources[0]!.inputPath), "utf8")).toBe(design);
  });

  it("marks required context with a bad hash incomplete and does not materialize it", async () => {
    const result = await materializeReviewInput(dependencies(), observedPullRequest(), snapshot({
      sources: [{ ...snapshot().sources[0]!, contentHash: sha256("different") }],
    }), "review-input-hash-mismatch");

    expect(result.coverage.status).toBe("partial");
    expect(result.coverage.incompleteReasons).toContain("required-context-hash-mismatch");
    expect(result.sources).toHaveLength(0);
    expect(result.coverage.sourceExclusions).toMatchObject([{ sourceId: "source_design", reason: "hash-mismatch", required: true }]);
  });

  it("records required unapproved or missing sources as incomplete instead of passing with a thinner brief", async () => {
    const unapproved = await materializeReviewInput(dependencies(), observedPullRequest(), snapshot({
      sources: [{ ...snapshot().sources[0]!, approval: "pending" }],
    }), "review-input-unapproved");
    const missing = await materializeReviewInput(dependencies(), observedPullRequest(), snapshot({
      sources: [{ ...snapshot().sources[0]!, availability: "missing", commit: undefined, contentHash: undefined }],
    }), "review-input-missing");

    expect(unapproved.coverage.status).toBe("partial");
    expect(unapproved.coverage.incompleteReasons).toContain("required-context-not-approved");
    expect(missing.coverage.status).toBe("partial");
    expect(missing.coverage.incompleteReasons).toContain("required-context-missing");
  });

  it("uses Git enumeration for every changed file beyond the provider API cap", async () => {
    const files = Array.from({ length: 3_001 }, (_, index) => ({
      path: `src/generated/file-${String(index).padStart(4, "0")}.ts`,
      content: `export const file${index} = ${index};\n`,
    }));
    const largeBranch = "feature/review-large";
    fixture.git(codeRepositoryId, "update-ref", `refs/heads/${largeBranch}`, codeBase);
    const largeHead = await fixture.commitFiles(codeRepositoryId, files, largeBranch);
    fixture.git(codeRepositoryId, "update-ref", "refs/pull/17/head", largeHead);
    const observed = { ...observedPullRequest(), headSha: largeHead };

    try {
      const manifest = await materializeReviewInput(dependencies(), observed, snapshot(), "review-input-large-diff");

      expect(manifest.changedFileCount).toBe(3_001);
      expect(manifest.changedFiles).toHaveLength(3_001);
      expect(manifest.omittedChangedFileCount).toBe(0);
      expect(manifest.changedFiles[0]?.path).toBe("src/generated/file-0000.ts");
      expect(manifest.changedFiles.at(-1)?.path).toBe("src/generated/file-3000.ts");
      expect(manifest.coverage.generatedFiles).toBe(3_001);
    } finally {
      fixture.git(codeRepositoryId, "update-ref", "refs/pull/17/head", codeHead);
    }
  });

  it("marks a pinned source object that is no longer available as incomplete", async () => {
    const result = await materializeReviewInput(dependencies(), observedPullRequest(), snapshot({
      sources: [{ ...snapshot().sources[0]!, commit: "c".repeat(40) }],
    }), "review-input-missing-object");

    expect(result.coverage.status).toBe("partial");
    expect(result.coverage.incompleteReasons).toContain("required-context-missing");
    expect(result.coverage.sourceExclusions).toMatchObject([{ sourceId: "source_design", reason: "missing-object", required: true }]);
    expect(result.sources).toHaveLength(0);
  });
});
