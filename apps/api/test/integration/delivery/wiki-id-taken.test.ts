// A new page whose id another page already holds (P2-055, ADR-0096 decision 4): the publish is refused with a 409
// `id-taken` before anything is written, naming the page that holds the id, and the draft is given the next free id of
// its scope, so the author publishes again instead of being stuck. The other page is a file at the head of the default
// branch or a write that is open for it, which the writer cannot see yet.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Draft {
  revision: number;
  text: string;
  pageId: string | null;
  writeId: string | null;
}

const EXISTING = "---\nid: PAGE-DOC-0001\ntitle: Existing\n---\n\n# Existing\n";
const page = (id: string, title: string): string => `---\nid: ${id}\ntitle: ${title}\n---\n\n# ${title}\n`;

describe.skipIf(!hasDatabase)("wiki publish: a page id another page holds (integration)", () => {
  let app: TestApp;
  let dataDir: string;
  let a: Client;
  let b: Client;
  let head: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: join(dataDir, "work"), encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const save = async (client: Client, path: string, text: string, baseCommit?: string): Promise<number> => {
    const response = await client.request<Draft>("PUT", "/projects/shop/wiki/draft", { body: { path, text, baseRevision: null, ...(baseCommit === undefined ? {} : { baseCommit }) } });
    expect(response.status, response.raw).toBe(200);
    return response.body.data!.revision;
  };
  const publish = (client: Client, body: Record<string, unknown>) => client.request<{ outcome: string; write: { id: string } }>("POST", "/projects/shop/wiki/publish", { body: { message: "Publish", ...body } });
  const draft = async (client: Client, path: string) => (await client.get<Draft>(`/projects/shop/wiki/draft?path=${encodeURIComponent(path)}`)).body.data!;
  const writes = async () => (await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n;
  const payload = async (writeId: string) => (await app.db.query<{ data: { page: { id: string | null; path: string }; files: Array<{ path: string; content: string }> } }>("select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1", [writeId])).rows[0]!.data;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-idtaken-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    for (const [path, content] of [
      ["20-docs/existing.md", EXISTING],
      ["10-eng/plain.md", "# Plain\n\nNo id.\n"],
    ] as const) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), content);
      git("add", path);
    }
    git("commit", "-q", "-m", "start");
    head = git("rev-parse", "HEAD");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    const admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    ({ client: a } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: b } = await memberClient(app, admin, "editor-b", ["user", "wiki-editor"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("refuses an id a file of the default branch holds, writes nothing, and the next publish goes on with a new id", async () => {
    const path = "10-eng/new-page.md";
    const revision = await save(a, path, page("PAGE-DOC-0001", "New page"));
    const before = await writes();
    const refused = await publish(a, { path, revision });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ statusCode: 409, details: { code: "id-taken", path: "20-docs/existing.md", pageId: expect.stringMatching(/^PAGE-DOC-\d{4}$/), revision: revision + 1 } });
    expect(refused.body.message).toContain("20-docs/existing.md");
    expect(await writes()).toBe(before);

    const newId = (refused.body as unknown as { details: { pageId: string } }).details.pageId;
    expect(newId).not.toBe("PAGE-DOC-0001");
    const reissued = await draft(a, path);
    expect(reissued).toMatchObject({ pageId: newId, revision: revision + 1, text: page(newId, "New page") });

    const done = await publish(a, { path, revision: reissued.revision });
    expect(done.body.data?.outcome).toBe("published");
    const data = await payload(done.body.data!.write.id);
    expect(data.page).toEqual({ id: newId, path, minor: false });
    expect(data.files[0]!.content).toBe(page(newId, "New page"));
  });

  it("refuses an id another person's open write carries, which the head does not show yet, and gives the draft another", async () => {
    const first = "10-eng/first.md";
    const second = "10-eng/second.md";
    const revisionA = await save(a, first, page("PAGE-DOC-0050", "First"));
    const revisionB = await save(b, second, page("PAGE-DOC-0050", "Second"));
    expect((await publish(a, { path: first, revision: revisionA })).body.data?.outcome).toBe("published");

    const refused = await publish(b, { path: second, revision: revisionB });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ details: { code: "id-taken", path: first, pageId: expect.stringMatching(/^PAGE-DOC-\d{4}$/) } });
    const newId = (refused.body as unknown as { details: { pageId: string } }).details.pageId;
    expect(newId).not.toBe("PAGE-DOC-0050");
    const done = await publish(b, { path: second, revision: revisionB + 1 });
    expect(done.body.data?.outcome).toBe("published");
    expect((await payload(done.body.data!.write.id)).page.id).toBe(newId);
  });

  it("keeps the id of a page that already exists: the publish is refused naming the page that holds the id, and the draft is left as it is", async () => {
    // plain.md is at the head without an id; its draft gives it the id of existing.md. Giving it another would break the
    // links that use its address, so nothing is changed and nothing is written.
    const path = "10-eng/plain.md";
    const text = page("PAGE-DOC-0001", "Plain");
    const revision = await save(a, path, text, head);
    const before = await writes();
    const refused = await publish(a, { path, revision });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ details: { code: "id-taken", path: "20-docs/existing.md" } });
    expect(refused.body as unknown as { details: Record<string, unknown> }).not.toHaveProperty("details.pageId");
    expect(refused.body as unknown as { details: Record<string, unknown> }).not.toHaveProperty("details.revision");
    expect(await writes()).toBe(before);
    expect(await draft(a, path)).toMatchObject({ revision, text, pageId: null });
    await a.request("DELETE", `/projects/shop/wiki/draft?path=${encodeURIComponent(path)}`);
  });

  it("does not take a page's own id for another page's, and leaves a page without an id alone", async () => {
    // A page edited under its own path keeps its id.
    const revision = await save(a, "20-docs/existing.md", `${EXISTING}\nMore.\n`, head);
    const edited = await publish(a, { path: "20-docs/existing.md", revision });
    expect(edited.body.data?.outcome).toBe("published");
    expect((await payload(edited.body.data!.write.id)).page.id).toBe("PAGE-DOC-0001");
    // No id, nothing to check.
    const plainRevision = await save(b, "10-eng/plain.md", "# Plain\n\nNo id, edited.\n", head);
    expect((await publish(b, { path: "10-eng/plain.md", revision: plainRevision })).body.data?.outcome).toBe("published");
  });
});
