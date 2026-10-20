// The writer against a real git remote and a throwaway database: auto-commit paths on the
// default branch, other paths on kintsugi/* branches with a pull request (mocked API),
// kintsugi.yaml's autoCommitPaths, output rules, plain-git servers and the queue end to end.

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckoutStorage, DEFAULT_COMMIT_IDENTITY } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentWriteStore, type DocumentRepoTarget } from "../src/document-write/store.js";
import { watchPullRequests } from "../src/document-write/watch.js";
import { type WriterDeps, writeDocument } from "../src/document-write/writer.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { startWorker } from "../src/worker.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const API_TOKEN = "TEST-api-token-0123456789";
const BOT_NAME = "Modernization Bot";
const BOT_EMAIL = "bot@kintsugi.test";

/**
 * The test remote is anonymous plain http, which never carries a token; the pull-request API
 * token is injected here instead, as a token-authenticated server would provide it.
 */
class TestWriteStore extends DocumentWriteStore {
  override async target(projectId: string): Promise<DocumentRepoTarget | undefined> {
    const target = await super.target(projectId);
    return target === undefined || target.serverKind === "plain-git" ? target : { ...target, apiToken: API_TOKEN };
  }
}

interface Row {
  status: string;
  commit_sha: string | null;
  branch: string | null;
  branch_commit_sha: string | null;
  pr_url: string | null;
  error: string | null;
}

describe.skipIf(!hasDatabase)("document writer (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let deps: WriterDeps;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url: String(url), body });
    return new Response(JSON.stringify({ web_url: `https://gitlab.example.invalid/docs/-/merge_requests/${requests.length}`, iid: requests.length }), { status: 201 });
  }) as typeof fetch;

  const row = async (id: string): Promise<Row | undefined> =>
    (await db.pool.query<Row>("select status, commit_sha, branch, branch_commit_sha, pr_url, error from workflow.document_write where id = $1", [id])).rows[0];

  const request = (projectId: string, overrides: Partial<DocumentWriteRequest> = {}): DocumentWriteRequest => ({
    writeId: randomUUID(),
    projectId,
    kind: "manifest",
    message: "Publish kintsugi.yaml",
    actor: "alice",
    ...overrides,
  });

  const project = async (id: string, serverId: string, kind: string, baseUrl: string): Promise<void> => {
    await remote.createRepository(id);
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ($1, $2, $1, $3, 'none')", [serverId, kind, baseUrl]);
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ($1, $2, $3, 'main')", [id, serverId, `${remote.baseUrl}/${id}.git`]);
    await db.pool.query("insert into admin.project (id, name) values ($1, $1)", [id]);
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ($1, $1, 'document')", [id]);
  };

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-writer-data-"));
    const storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    const repositories = new RepositoryStore(db.pool);
    deps = { writes: new TestWriteStore(db.pool, repositories), repositories, storage, fetch: fakeFetch };
    // The commit identity is an installation setting managed in the portal, read per write.
    await db.pool.query("insert into admin.installation_setting (key, value) values ($1, $2)", ["commit-identity", JSON.stringify({ name: BOT_NAME, email: BOT_EMAIL })]);
    // A GitLab server for the pull-request API; its repositories are served by the local remote.
    await project("docs", "gitlab", "gitlab", "https://gitlab.example.invalid");
    await project("plain-docs", "plain", "plain-git", remote.baseUrl);
  });
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("reads the commit identity per write and falls back to the defaults when it is unset or unusable", async () => {
    expect(await deps.writes.commitIdentity()).toEqual({ name: BOT_NAME, email: BOT_EMAIL });
    const set = (value: unknown): Promise<unknown> => db.pool.query("update admin.installation_setting set value = $2 where key = $1", ["commit-identity", JSON.stringify(value)]);
    try {
      await set({ name: "Bot <x>", email: "not-an-email" });
      expect(await deps.writes.commitIdentity()).toEqual(DEFAULT_COMMIT_IDENTITY);
      await set({});
      expect(await deps.writes.commitIdentity()).toEqual(DEFAULT_COMMIT_IDENTITY);
    } finally {
      await set({ name: BOT_NAME, email: BOT_EMAIL });
    }
  });

  it("auto-commits units/** to main and proposes kintsugi.yaml in a pull request", async () => {
    const write = request("docs", {
      files: [
        { path: "kintsugi.yaml", content: "schemaVersion: 1\n" },
        { path: "applications/web/units/auth/login/unit.md", content: "---\nid: web/auth/login\n---\n" },
      ],
    });
    const outcome = await writeDocument(deps, write);
    expect(outcome).toMatchObject({ status: "pr-opened", branch: `kintsugi/alice/${write.writeId}`, prUrl: "https://gitlab.example.invalid/docs/-/merge_requests/1" });

    expect(remote.git("docs", "show", "main:applications/web/units/auth/login/unit.md")).toContain("web/auth/login");
    expect(() => remote.git("docs", "show", "main:kintsugi.yaml")).toThrow();
    expect(remote.git("docs", "show", `kintsugi/alice/${write.writeId}:kintsugi.yaml`)).toBe("schemaVersion: 1\n");
    expect(remote.git("docs", "log", "-1", "--format=%an <%ae>%n%(trailers:only,unfold)", "main").trim()).toBe(`${BOT_NAME} <${BOT_EMAIL}>\nKintsugi-Actor: alice`);

    expect(requests[0]).toMatchObject({
      url: "https://gitlab.example.invalid/api/v4/projects/docs/merge_requests",
      body: { source_branch: `kintsugi/alice/${write.writeId}`, target_branch: "main", title: "Publish kintsugi.yaml" },
    });
    expect(await row(write.writeId)).toMatchObject({
      status: "pr-opened",
      commit_sha: remote.git("docs", "rev-parse", "main").trim(),
      branch: `kintsugi/alice/${write.writeId}`,
      branch_commit_sha: remote.git("docs", "rev-parse", `kintsugi/alice/${write.writeId}`).trim(),
      error: null,
    });
  });

  it("puts auto-commit paths in the pull request too when the write asks for review of everything", async () => {
    const write = request("docs", {
      reviewAll: true,
      files: [
        { path: "applications/web/units/auth/login/as-is.md", content: "# Login\n" },
        { path: "applications/web/units/auth/proposed/unit.md", content: "---\nid: web/auth/proposed\n---\n" },
      ],
    });
    const before = remote.git("docs", "rev-parse", "main").trim();
    expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened", branch: `kintsugi/alice/${write.writeId}` });
    expect(remote.git("docs", "rev-parse", "main").trim()).toBe(before);
    expect(() => remote.git("docs", "show", "main:applications/web/units/auth/proposed/unit.md")).toThrow();
    expect(remote.git("docs", "show", `kintsugi/alice/${write.writeId}:applications/web/units/auth/proposed/unit.md`)).toContain("web/auth/proposed");
    expect(remote.git("docs", "show", `kintsugi/alice/${write.writeId}:applications/web/units/auth/login/as-is.md`)).toBe("# Login\n");
  });

  it("follows autoCommitPaths from kintsugi.yaml on the default branch", async () => {
    const manifest = [
      "schemaVersion: 1",
      "project: {id: docs, name: Docs}",
      "document: {server: gitlab, path: docs}",
      "unitKinds: [screen]",
      "applications: []",
      "autoCommitPaths: [notes/**]",
      "",
    ].join("\n");
    await remote.commit("docs", "kintsugi.yaml", manifest);
    const write = request("docs", { files: [{ path: "notes/a.md", content: "a\n" }] });
    expect(await writeDocument(deps, write)).toMatchObject({ status: "committed" });
    expect(remote.git("docs", "show", "main:notes/a.md")).toBe("a\n");

    const units = request("docs", { files: [{ path: "applications/web/units/core/b/unit.md", content: "b\n" }] });
    expect(await writeDocument(deps, units)).toMatchObject({ status: "pr-opened" });
    expect(() => remote.git("docs", "show", "main:applications/web/units/core/b/unit.md")).toThrow();
  });

  it("writes a runtime job's /out with job and agent trailers", async () => {
    const out = deps.storage.job("job-42").out;
    await mkdir(join(out, "assessment", "web"), { recursive: true });
    await writeFile(join(out, "assessment", "web", "ASSESSMENT.md"), "# Assessment\n");
    const write = request("docs", { kind: "job-output", message: "Assessment of web", outputOfJob: "job-42", jobId: "job-42", agent: "legacy-analyst@1.0.0", actor: undefined });
    delete write.actor;
    expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened", branch: "kintsugi/legacy-analyst/job-42" });
    expect(remote.git("docs", "log", "-1", "--format=%(trailers:only,unfold)", "kintsugi/legacy-analyst/job-42").trim()).toBe(
      "Kintsugi-Job: job-42\nKintsugi-Agent: legacy-analyst@1.0.0",
    );
  });

  it("records output rule violations without retrying", async () => {
    for (const path of ["../escape.md", "/etc/passwd", ".git/config"]) {
      const write = request("docs", { files: [{ path, content: "x" }] });
      expect(await writeDocument(deps, write)).toMatchObject({ status: "failed" });
      expect((await row(write.writeId))?.error).toMatch(/Invalid repository path/);
    }
    const huge = request("docs", { files: [{ path: "big.bin", content: "x".repeat(6 * 1024 * 1024) }] });
    expect(await writeDocument(deps, huge)).toMatchObject({ status: "failed" });
    expect((await row(huge.writeId))?.error).toMatch(/limit/);
  });

  it("reports identical files as unchanged", async () => {
    const write = request("docs", { files: [{ path: "README.md", content: "docs\n" }] });
    expect(await writeDocument(deps, write)).toEqual({ status: "unchanged" });
    expect((await row(write.writeId))?.status).toBe("unchanged");
  });

  it("only pushes the branch on plain-git servers", async () => {
    const before = requests.length;
    const write = request("plain-docs", { files: [{ path: "kintsugi.yaml", content: "schemaVersion: 1\n" }] });
    expect(await writeDocument(deps, write)).toMatchObject({ status: "committed", branch: `kintsugi/alice/${write.writeId}` });
    expect(remote.git("plain-docs", "show", `kintsugi/alice/${write.writeId}:kintsugi.yaml`)).toBe("schemaVersion: 1\n");
    expect(requests.length).toBe(before);
    expect((await row(write.writeId))?.pr_url).toBeNull();
  });

  it("the worker runs queued writes, one per repository at a time", async () => {
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage: deps.storage, pollIntervalSeconds: 3600, log: () => undefined });
    try {
      const writes = [1, 2, 3].map((n) => request("plain-docs", { kind: "state-change", message: `Unit ${n}`, files: [{ path: `applications/demo/units/core/u${n}/unit.md`, content: `${n}\n` }] }));
      for (const write of writes) await worker.requestWrite("plain-docs", write);
      for (const write of writes) {
        await expect.poll(async () => (await row(write.writeId))?.status, { timeout: 30_000, interval: 250 }).toBe("committed");
      }
      for (const n of [1, 2, 3]) expect(remote.git("plain-docs", "show", `main:applications/demo/units/core/u${n}/unit.md`)).toBe(`${n}\n`);
    } finally {
      await worker.stop();
    }
  });

  describe("review watch", () => {
    const status = async (id: string): Promise<string | undefined> => (await row(id))?.status;
    const review = (projectId: string): DocumentWriteRequest => request(projectId, { files: [{ path: "kintsugi.yaml", content: "schemaVersion: 1\n" }] });

    it("records a merge it sees in git when there is no pull request (plain-git)", async () => {
      const write = review("plain-docs");
      const outcome = await writeDocument(deps, write);
      expect(outcome).toMatchObject({ status: "committed", branch: `kintsugi/alice/${write.writeId}` });

      expect((await watchPullRequests(deps)).merged).not.toContain(write.writeId);
      expect(await status(write.writeId)).toBe("committed");

      // A person merges the branch: its tip becomes part of main.
      remote.git("plain-docs", "update-ref", "refs/heads/main", String((await row(write.writeId))?.branch_commit_sha));
      expect((await watchPullRequests(deps)).merged).toContain(write.writeId);
      expect(await status(write.writeId)).toBe("merged");
      // A recorded outcome is final: the next pass does not look at it again.
      expect((await watchPullRequests(deps)).merged).not.toContain(write.writeId);
    });

    it("asks the server about open pull requests: squash merges and closes are recorded, open ones stay", async () => {
      const [merged, closed, open] = [review("docs"), review("docs"), review("docs")];
      const numbers = new Map<string, number>();
      for (const write of [merged, closed, open]) {
        await writeDocument(deps, write);
        numbers.set(write.writeId, Number(/(\d+)$/.exec(String((await row(write.writeId))?.pr_url))?.[1]));
      }
      const states: Record<number, string> = { [numbers.get(merged.writeId)!]: "merged", [numbers.get(closed.writeId)!]: "closed" };
      const asked: string[] = [];
      const serverFetch = (async (url: string | URL | Request): Promise<Response> => {
        asked.push(String(url));
        const number = Number(/(\d+)$/.exec(String(url))?.[1]);
        return new Response(JSON.stringify({ state: states[number] ?? "opened" }), { status: 200 });
      }) as typeof fetch;

      const result = await watchPullRequests({ ...deps, fetch: serverFetch });
      expect(result.merged).toContain(merged.writeId);
      expect(result.closed).toContain(closed.writeId);
      expect(result.merged).not.toContain(open.writeId);
      expect(await status(merged.writeId)).toBe("merged");
      expect(await status(closed.writeId)).toBe("closed");
      expect(await status(open.writeId)).toBe("pr-opened");
      expect(asked.some((url) => url.startsWith("https://gitlab.example.invalid/api/v4/projects/docs/merge_requests/"))).toBe(true);
    });

    it("a server that cannot be read leaves the write waiting and does not stop the pass", async () => {
      const write = review("docs");
      await writeDocument(deps, write);
      const lines: string[] = [];
      const broken = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
      const result = await watchPullRequests({ ...deps, fetch: broken, log: (line) => lines.push(line) });
      expect(result.merged).toEqual([]);
      expect(await status(write.writeId)).toBe("pr-opened");
      expect(lines.some((line) => line.includes("could not read its state"))).toBe(true);
    });
  });
});
