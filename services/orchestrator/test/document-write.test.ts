// The writer against a real git remote and a throwaway database: auto-commit paths on the
// default branch, other paths on kintsugi/* branches with a pull request (mocked API),
// kintsugi.yaml's autoCommitPaths, output rules, plain-git servers and the queue end to end.

import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { onDefaultTipMove } from "../src/git-sync/sync.js";
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

  it("auto-commits unit cards to main and proposes kintsugi.yaml in a pull request", async () => {
    const write = request("docs", {
      files: [
        { path: "kintsugi.yaml", content: "schemaVersion: 1\n" },
        { path: "10-applications/web/02-modern/auth/login/README.md", content: "---\nid: web/auth/login\n---\n" },
      ],
    });
    const outcome = await writeDocument(deps, write);
    expect(outcome).toMatchObject({ status: "pr-opened", branch: `kintsugi/alice/${write.writeId}`, prUrl: "https://gitlab.example.invalid/docs/-/merge_requests/1" });

    expect(remote.git("docs", "show", "main:10-applications/web/02-modern/auth/login/README.md")).toContain("web/auth/login");
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

  it("puts the description a stage wrote between the message and the file list of the pull request", async () => {
    const write = request("docs", {
      message: "Design web: detail of auth",
      description: "## Review of the design run: detail\n\n1 unit(s): 1 ready.",
      files: [{ path: "10-applications/web/02-modern/auth/login/detail/logic.md", content: "# Logic\n" }],
      reviewAll: true,
    });
    expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened" });
    const body = String((requests[requests.length - 1]?.body as { description?: unknown }).description);
    expect(body.split("\n")).toEqual(expect.arrayContaining(["Design web: detail of auth", "## Review of the design run: detail", "Files:"]));
    expect(body.indexOf("Design web: detail of auth")).toBeLessThan(body.indexOf("## Review of the design run"));
    expect(body.indexOf("## Review of the design run")).toBeLessThan(body.indexOf("Files:"));
  });

  it("puts auto-commit paths in the pull request too when the write asks for review of everything", async () => {
    const write = request("docs", {
      reviewAll: true,
      files: [
        { path: "10-applications/web/01-legacy/auth/login/spec.md", content: "# Login\n" },
        { path: "10-applications/web/02-modern/auth/proposed/README.md", content: "---\nid: web/auth/proposed\n---\n" },
      ],
    });
    const before = remote.git("docs", "rev-parse", "main").trim();
    expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened", branch: `kintsugi/alice/${write.writeId}` });
    expect(remote.git("docs", "rev-parse", "main").trim()).toBe(before);
    expect(() => remote.git("docs", "show", "main:10-applications/web/02-modern/auth/proposed/README.md")).toThrow();
    expect(remote.git("docs", "show", `kintsugi/alice/${write.writeId}:10-applications/web/02-modern/auth/proposed/README.md`)).toContain("web/auth/proposed");
    expect(remote.git("docs", "show", `kintsugi/alice/${write.writeId}:10-applications/web/01-legacy/auth/login/spec.md`)).toBe("# Login\n");
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

    const units = request("docs", { files: [{ path: "10-applications/web/02-modern/core/b/README.md", content: "b\n" }] });
    expect(await writeDocument(deps, units)).toMatchObject({ status: "pr-opened" });
    expect(() => remote.git("docs", "show", "main:10-applications/web/02-modern/core/b/README.md")).toThrow();
  });

  it("writes a runtime job's /out with job and agent trailers", async () => {
    const out = deps.storage.job("job-42").out;
    await mkdir(join(out, "10-applications", "web", "01-legacy"), { recursive: true });
    await writeFile(join(out, "10-applications", "web", "01-legacy", "assessment.md"), "# Assessment\n");
    const write = request("docs", { kind: "job-output", message: "Assessment of web", outputOfJob: "job-42", jobId: "job-42", agent: "legacy-analyst@1.0.0", actor: undefined });
    delete write.actor;
    expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened", branch: "kintsugi/legacy-analyst/job-42" });
    expect(remote.git("docs", "log", "-1", "--format=%(trailers:only,unfold)", "kintsugi/legacy-analyst/job-42").trim()).toBe(
      "Kintsugi-Job: job-42\nKintsugi-Agent: legacy-analyst@1.0.0",
    );
  });

  it("gives an empty document repository a first commit, then proposes the files on top of it", async () => {
    await remote.createEmptyRepository("empty-docs");
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ($1, 'plain', $2, 'main')", ["empty-docs", `${remote.baseUrl}/empty-docs.git`]);
    await db.pool.query("insert into admin.project (id, name) values ($1, $1)", ["empty-docs"]);
    await db.pool.query("insert into admin.project_repository (project_id, repository_id, role) values ($1, $1, 'document')", ["empty-docs"]);
    const write = request("empty-docs", { files: [{ path: "kintsugi.yaml", content: "schemaVersion: 1\n" }] });
    expect(await writeDocument(deps, write)).toMatchObject({ status: "committed", branch: `kintsugi/alice/${write.writeId}` });
    expect(remote.git("empty-docs", "show", "main:README.md")).toContain("# Document repository");
    expect(remote.git("empty-docs", "show", `kintsugi/alice/${write.writeId}:kintsugi.yaml`)).toBe("schemaVersion: 1\n");
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

  it("refuses a page whose id another file already holds, and commits nothing (P2-029)", async () => {
    const holder = "---\nid: PAGE-ENG-0001\ntitle: Holder\n---\n\n# Holder\n";
    await remote.commit("docs", "20-spaces/eng/holder.md", holder);
    const before = remote.git("docs", "rev-parse", "main").trim();
    const twin = request("docs", { kind: "job-output", files: [{ path: "20-spaces/eng/twin.md", content: "---\nid: PAGE-ENG-0001\n---\n\n# Twin\n" }] });
    expect(await writeDocument(deps, twin)).toMatchObject({ status: "failed" });
    expect((await row(twin.writeId))?.error).toBe("Page id PAGE-ENG-0001 is already defined by 20-spaces/eng/holder.md");
    expect(remote.git("docs", "rev-parse", "main").trim()).toBe(before);
    expect(() => remote.git("docs", "rev-parse", `kintsugi/alice/${twin.writeId}`)).toThrow();

    // The page itself, edited, and another page with its own id, are accepted.
    const edit = request("docs", { kind: "job-output", files: [{ path: "20-spaces/eng/holder.md", content: `${holder}\nMore text.\n` }] });
    expect(await writeDocument(deps, edit)).toMatchObject({ status: "pr-opened" });
    const fresh = request("docs", { kind: "job-output", files: [{ path: "20-spaces/eng/fresh.md", content: "---\nid: PAGE-ENG-0002\n---\n\n# Fresh\n" }] });
    expect(await writeDocument(deps, fresh)).toMatchObject({ status: "pr-opened" });
  });

  describe("page writes (P2-028)", () => {
    const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
    const manifest = (extra: string[]): string =>
      ["schemaVersion: 1", "project: {id: page-docs, name: Pages}", "document: {server: gitlab, path: page-docs}", "unitKinds: [screen]", "applications: []", ...extra, ""].join("\n");
    const page = (id: string, body = "Body.\n"): string => `---\nid: ${id}\ntitle: A page\n---\n\n# A page\n\n${body}`;
    const pageWrite = (overrides: Partial<DocumentWriteRequest>): DocumentWriteRequest => request("page-docs", { kind: "page", ...overrides });

    beforeAll(async () => {
      await project("page-docs", "page-server", "gitlab", remote.baseUrl);
      await remote.commitFiles("page-docs", [
        { path: "kintsugi.yaml", content: manifest(["autoCommitPaths: [20-spaces/**]", "directPublishPaths: [20-spaces/eng/**]"]) },
        { path: "20-spaces/eng/old.md", content: page("PAGE-ENG-0001") },
        { path: "20-spaces/eng/gone.md", content: page("PAGE-ENG-0002") },
        { path: "20-spaces/hr/policy.md", content: page("PAGE-HR-0001") },
      ]);
    });

    it("publishes straight to the default branch when every path is in directPublishPaths: delete, move and base64 files in one commit with the page trailers", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
      const write = pageWrite({
        message: "Reorganise the engineering pages",
        directPublish: true,
        page: { id: "PAGE-ENG-0001", path: "20-spaces/eng/new.md", minor: true },
        files: [
          { path: "20-spaces/eng/new.md", renameFrom: "20-spaces/eng/old.md", content: page("PAGE-ENG-0001", "Body, edited.\n"), expectedHash: sha(page("PAGE-ENG-0001")) },
          { path: "20-spaces/eng/gone.md", delete: true, content: "", expectedHash: sha(page("PAGE-ENG-0002")) },
          { path: "20-spaces/eng/_attachments/a.png", content: png.toString("base64"), encoding: "base64" },
        ],
      });
      expect(await writeDocument(deps, write)).toMatchObject({ status: "committed" });
      expect(remote.git("page-docs", "show", "main:20-spaces/eng/new.md")).toContain("Body, edited.");
      expect(() => remote.git("page-docs", "show", "main:20-spaces/eng/old.md")).toThrow();
      expect(() => remote.git("page-docs", "show", "main:20-spaces/eng/gone.md")).toThrow();
      expect(remote.git("page-docs", "cat-file", "-s", "main:20-spaces/eng/_attachments/a.png").trim()).toBe(String(png.length));
      expect(remote.git("page-docs", "log", "-1", "--format=%an%n%(trailers:only,unfold)", "main").trim().split("\n")).toEqual([BOT_NAME, "Kintsugi-Actor: alice", "Kintsugi-Page: PAGE-ENG-0001", "Kintsugi-Minor: true"]);
      // One commit, and history follows the move.
      const changes = remote.git("page-docs", "show", "--name-status", "-M", "--format=", "main").trim().split("\n").map((line) => line.replace(/^R\d+/, "R"));
      expect(changes.sort()).toEqual(["A\t20-spaces/eng/_attachments/a.png", "D\t20-spaces/eng/gone.md", "R\t20-spaces/eng/old.md\t20-spaces/eng/new.md"]);
    });

    it("tells the listeners of the default branch that a direct publish moved it, so the Brain is built at once (P-009)", async () => {
      const moves: Array<{ repositoryId: string; previous: string; commit: string }> = [];
      const stop = onDefaultTipMove((move) => void moves.push({ repositoryId: move.repositoryId, previous: move.previous, commit: move.commit }));
      try {
        const before = remote.git("page-docs", "rev-parse", "main").trim();
        const write = pageWrite({ message: "Edit a page directly", directPublish: true, page: { id: "PAGE-HR-0001", path: "20-spaces/eng/new.md", minor: false }, files: [{ path: "20-spaces/eng/new.md", content: page("PAGE-ENG-0001", "Edited again.\n"), expectedHash: sha(page("PAGE-ENG-0001", "Body, edited.\n")) }] });
        expect(await writeDocument(deps, write)).toMatchObject({ status: "committed" });
        // Before the write returns, the worker was told: the build does not wait for the periodic sweep.
        expect(moves).toEqual([{ repositoryId: "page-docs", previous: before, commit: remote.git("page-docs", "rev-parse", "main").trim() }]);
        // A write to a pull request does not move the default branch, so it tells nobody.
        moves.length = 0;
        const review = pageWrite({ message: "Edit a page for review", page: { id: "PAGE-HR-0001", path: "20-spaces/hr/policy.md", minor: false }, files: [{ path: "20-spaces/hr/policy.md", content: page("PAGE-HR-0001", "For review.\n"), expectedHash: sha(page("PAGE-HR-0001")) }] });
        expect(await writeDocument(deps, review)).toMatchObject({ status: "pr-opened" });
        expect(moves).toEqual([]);
      } finally {
        stop();
      }
    });

    it("never uses autoCommitPaths: a page write that does not ask for direct publish goes to a pull request", async () => {
      const before = remote.git("page-docs", "rev-parse", "main").trim();
      const write = pageWrite({ message: "Edit a page", page: { id: "PAGE-HR-0001", path: "20-spaces/hr/policy.md", minor: false }, files: [{ path: "20-spaces/hr/policy.md", content: page("PAGE-HR-0001", "Changed.\n"), expectedHash: sha(page("PAGE-HR-0001")) }] });
      expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened", branch: `kintsugi/alice/${write.writeId}` });
      expect(remote.git("page-docs", "rev-parse", "main").trim()).toBe(before);
      // Not a minor edit, and no direct publish: the trailers say only what is true.
      expect(remote.git("page-docs", "log", "-1", "--format=%(trailers:only,unfold)", `kintsugi/alice/${write.writeId}`).trim().split("\n")).toEqual(["Kintsugi-Actor: alice", "Kintsugi-Page: PAGE-HR-0001"]);
    });

    it("sends the whole write to a pull request when one path is outside directPublishPaths", async () => {
      const before = remote.git("page-docs", "rev-parse", "main").trim();
      const write = pageWrite({
        message: "Two spaces at once",
        directPublish: true,
        files: [
          { path: "20-spaces/eng/inside.md", content: page("PAGE-ENG-0010") },
          { path: "20-spaces/hr/outside.md", content: page("PAGE-HR-0010") },
        ],
      });
      expect(await writeDocument(deps, write)).toMatchObject({ status: "pr-opened" });
      expect(remote.git("page-docs", "rev-parse", "main").trim()).toBe(before);
      expect(remote.git("page-docs", "show", `kintsugi/alice/${write.writeId}:20-spaces/eng/inside.md`)).toContain("PAGE-ENG-0010");
    });

    it("refuses a path the wiki may not write, a delete or move without its hash, and a write of another kind that deletes", async () => {
      const failed = async (write: DocumentWriteRequest, message: RegExp): Promise<void> => {
        expect(await writeDocument(deps, write)).toMatchObject({ status: "failed" });
        expect((await row(write.writeId))?.error).toMatch(message);
      };
      await failed(pageWrite({ files: [{ path: "kintsugi.yaml", content: "x\n" }] }), /not a path the wiki may write/);
      await failed(pageWrite({ files: [{ path: "plugins/p/README.md", content: "x\n" }] }), /not a path the wiki may write/);
      await failed(pageWrite({ files: [{ path: "20-spaces/eng/a/_attachments/s.svg", content: "<svg/>" }] }), /not a path the wiki may write/);
      await failed(pageWrite({ files: [{ path: "20-spaces/eng/b.md", renameFrom: "restricted/a.md", content: "x\n", expectedHash: sha("x\n") }] }), /not a path the wiki may write/);
      await failed(pageWrite({ files: [{ path: "20-spaces/eng/inside.md", delete: true, content: "" }] }), /needs the hash/);
      await failed(request("page-docs", { kind: "job-output", files: [{ path: "20-spaces/eng/inside.md", delete: true, content: "", expectedHash: sha("x") }] }), /cannot delete or move/);
      await failed(request("page-docs", { kind: "job-output", directPublish: true, files: [{ path: "20-spaces/eng/x.md", content: "x\n" }] }), /cannot delete or move/);
    });

    it("fails a delete or a move whose file changed since it was read, and commits nothing", async () => {
      const before = remote.git("page-docs", "rev-parse", "main").trim();
      const write = pageWrite({ directPublish: true, files: [{ path: "20-spaces/eng/gone2.md", renameFrom: "20-spaces/eng/new.md", content: "x\n", expectedHash: sha("an older text") }] });
      expect(await writeDocument(deps, write)).toMatchObject({ status: "failed" });
      expect((await row(write.writeId))?.status).toBe("failed");
      expect((await row(write.writeId))?.error).toMatch(/changed since it was read/);
      expect(remote.git("page-docs", "rev-parse", "main").trim()).toBe(before);
    });

    it("continues an open kintsugi/* branch: the pull request is updated and no new branch is made", async () => {
      const first = pageWrite({ message: "Draft of the runbook", files: [{ path: "20-spaces/hr/runbook.md", content: page("PAGE-HR-0020", "One.\n") }] });
      const opened = await writeDocument(deps, first);
      const branch = `kintsugi/alice/${first.writeId}`;
      expect(opened).toMatchObject({ status: "pr-opened", branch });
      const prUrl = (await row(first.writeId))?.pr_url;
      const prs = requests.length;

      const second = pageWrite({ message: "Second thoughts", continues: branch, files: [{ path: "20-spaces/hr/runbook.md", content: page("PAGE-HR-0020", "One, then two.\n") }] });
      expect(await writeDocument(deps, second)).toMatchObject({ status: "pr-opened", branch, prUrl });
      expect(requests.length).toBe(prs);
      expect(remote.git("page-docs", "show", `${branch}:20-spaces/hr/runbook.md`)).toContain("One, then two.");
      expect(remote.git("page-docs", "rev-list", "--count", `main..${branch}`).trim()).toBe("2");
      expect(remote.git("page-docs", "branch", "--list", `kintsugi/alice/${second.writeId}`).trim()).toBe("");
      expect((await row(second.writeId))?.branch).toBe(branch);
    });

    it("refuses to continue a branch that is not an open kintsugi/* branch of the project", async () => {
      for (const continues of ["main", "kintsugi/alice/never-made", "release/1", "kintsugi/../main"]) {
        const write = pageWrite({ continues, files: [{ path: "20-spaces/hr/x.md", content: page("PAGE-HR-0030") }] });
        expect(await writeDocument(deps, write), continues).toMatchObject({ status: "failed" });
        expect((await row(write.writeId))?.error, continues).toMatch(/not an open kintsugi\/\* branch/);
      }
    });

    it("records the merge commit when the review watch sees the branch merged, and a fast-forward is its own tip", async () => {
      const merge = pageWrite({ message: "To be merged", files: [{ path: "20-spaces/hr/merged.md", content: page("PAGE-HR-0040") }] });
      await writeDocument(deps, merge);
      const tip = String((await row(merge.writeId))?.branch_commit_sha);
      // A person merges the branch with a merge commit, and another change lands after it.
      const git = (...args: string[]): string => remote.git("page-docs", ...args);
      const main = git("rev-parse", "main").trim();
      const tree = git("rev-parse", `${tip}^{tree}`).trim();
      const mergeCommit = git("commit-tree", tree, "-p", main, "-p", tip, "-m", "Merge pull request").trim();
      git("update-ref", "refs/heads/main", mergeCommit);
      await remote.commit("page-docs", "20-spaces/hr/later.md", "later\n");

      expect((await watchPullRequests(deps)).merged).toContain(merge.writeId);
      const recorded = await db.pool.query<{ merge_commit: string | null }>("select merge_commit from workflow.document_write where id = $1", [merge.writeId]);
      expect(recorded.rows[0]?.merge_commit).toBe(mergeCommit);

      // A branch the default branch fast-forwarded to: the commit that brought it in is its tip.
      const ff = pageWrite({ message: "Fast-forwarded", files: [{ path: "20-spaces/hr/ff.md", content: page("PAGE-HR-0041") }] });
      await writeDocument(deps, ff);
      const ffTip = String((await row(ff.writeId))?.branch_commit_sha);
      git("update-ref", "refs/heads/main", ffTip, git("rev-parse", "main").trim());
      await remote.commit("page-docs", "20-spaces/hr/after-ff.md", "after\n");
      expect((await watchPullRequests(deps)).merged).toContain(ff.writeId);
      expect((await db.pool.query<{ merge_commit: string | null }>("select merge_commit from workflow.document_write where id = $1", [ff.writeId])).rows[0]?.merge_commit).toBe(ffTip);
    });
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

  it("runs a write again on the same branch when the queue retries it (DC-002)", async () => {
    const write = request("plain-docs", { files: [{ path: "kintsugi.yaml", content: "schemaVersion: 1\nretried: true\n" }] });
    const first = await writeDocument(deps, write);
    expect(first).toMatchObject({ status: "committed", branch: `kintsugi/alice/${write.writeId}` });
    // A worker stopped after the push: the retried job writes the same files to the same branch, and nothing fails.
    expect(await writeDocument(deps, write)).toEqual(first);
    expect(remote.git("plain-docs", "show", `kintsugi/alice/${write.writeId}:kintsugi.yaml`)).toBe("schemaVersion: 1\nretried: true\n");
  });

  it("the worker runs queued writes, one per repository at a time", async () => {
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage: deps.storage, pollIntervalSeconds: 3600, log: () => undefined });
    try {
      const writes = [1, 2, 3].map((n) => request("plain-docs", { kind: "state-change", message: `Unit ${n}`, files: [{ path: `10-applications/demo/02-modern/core/u${n}/README.md`, content: `${n}\n` }] }));
      for (const write of writes) await worker.requestWrite("plain-docs", write);
      for (const write of writes) {
        await expect.poll(async () => (await row(write.writeId))?.status, { timeout: 30_000, interval: 250 }).toBe("committed");
      }
      for (const n of [1, 2, 3]) expect(remote.git("plain-docs", "show", `main:10-applications/demo/02-modern/core/u${n}/README.md`)).toBe(`${n}\n`);
    } finally {
      await worker.stop();
    }
  });

  describe("create-only files (the starter structure)", () => {
    it("adds what the default branch lacks and never replaces a document that is there", async () => {
      const write = request("docs", {
        files: [
          { path: "kintsugi.yaml", content: "schemaVersion: 1\nproject: {}\n" },
          { path: "README.md", content: "starter readme\n", createOnly: true },
          { path: "00-project/charter.md", content: "# Charter\n", createOnly: true },
        ],
        reviewAll: true,
      });
      const outcome = await writeDocument(deps, write);
      const branch = `kintsugi/alice/${write.writeId}`;
      expect(outcome).toMatchObject({ status: "pr-opened", branch });
      // One pull request holds the manifest and the missing starter file; README.md was on main, so it is left alone.
      expect(remote.git("docs", "show", `${branch}:00-project/charter.md`)).toBe("# Charter\n");
      expect(remote.git("docs", "show", `${branch}:README.md`)).toBe("docs\n");
      expect(remote.git("docs", "show", `${branch}:kintsugi.yaml`)).toBe("schemaVersion: 1\nproject: {}\n");
      expect(() => remote.git("docs", "show", "main:00-project/charter.md")).toThrow();
    });

    it("is unchanged when every create-only file is already there", async () => {
      const write = request("docs", { files: [{ path: "README.md", content: "starter readme\n", createOnly: true }], reviewAll: true });
      expect(await writeDocument(deps, write)).toEqual({ status: "unchanged" });
      expect((await row(write.writeId))?.branch).toBeNull();
    });
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
