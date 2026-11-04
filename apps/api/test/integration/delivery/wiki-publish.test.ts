// Publishing a draft (ADR-0098, design-wiki-draft-publish section 3, roadmap exit 1): a plain publish when nobody touched
// the page, a three-way merge when someone did (preview first, never a silent overwrite, a conflict hands the three texts
// back), one open write per page, a pull request unless the manifest allows a direct publish. The document repo is a real
// bare mirror; the worker is not run, its outcome is recorded by the test.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WikiDirectPublish } from "#modules/delivery/wiki/index.js";
import { type Client, adminClient, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Published {
  outcome: string;
  merged?: string;
  head?: { commit: string; hash: string | null };
  base?: { commit: string | null; hash: string | null };
  write?: { id: string; status: string; mode: string; branch?: string; prUrl?: string };
}
interface Draft {
  revision: number;
  text: string;
  writeId: string | null;
}
interface Payload {
  kind: string;
  actor: string;
  message: string;
  directPublish?: boolean;
  continues?: string;
  page: { id: string | null; path: string; minor: boolean };
  files: Array<{ path: string; content: string; expectedHash?: string; createOnly?: boolean }>;
}

const sha256 = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const PAGE = "10-eng/guide.md";
const BASE = "# Guide\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.\n";

describe.skipIf(!hasDatabase)("wiki publish (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let mirror: string;
  let a: Client;
  let b: Client;
  let publisher: Client;
  let reader: Client;
  let head: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  /** What the worker would do when a write is merged: the text is on the default branch of the document repo and its mirror. */
  const land = async (path: string, text: string, writeId?: string): Promise<string> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), text);
    git("add", path);
    git("commit", "-q", "-m", `land ${path}`);
    head = git("rev-parse", "HEAD");
    execFileSync("git", ["--git-dir", mirror, "fetch", "-q", work, "+refs/heads/main:refs/heads/main"]);
    if (writeId !== undefined) await app.db.query("update workflow.document_write set status = 'merged', branch = 'kintsugi/x' where id = $1", [writeId]);
    return head;
  };
  const save = async (client: Client, path: string, text: string, baseCommit?: string): Promise<number> => {
    const response = await client.request<Draft>("PUT", "/projects/shop/wiki/draft", { body: { path, text, baseRevision: null, ...(baseCommit === undefined ? {} : { baseCommit }) } });
    expect(response.status, response.raw).toBe(200);
    return response.body.data!.revision;
  };
  const publish = (client: Client, body: Record<string, unknown>) => client.request<Published>("POST", "/projects/shop/wiki/publish", { body: { message: "Update the page", ...body } });
  const payload = async (writeId: string): Promise<Payload> => (await app.db.query<{ data: Payload }>("select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1", [writeId])).rows[0]!.data;
  const writes = async (path: string) => (await app.db.query<{ id: string; status: string }>("select id, status from workflow.document_write where page_path = $1 order by created_at", [path])).rows;
  const audit = async (action: string) => (await app.db.query<{ detail: Record<string, unknown> }>("select detail from governance.audit_event where action = $1 order by id", [action])).rows.map((row) => row.detail);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-publish-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await mkdir(join(work, "10-eng"));
    await writeFile(join(work, PAGE), BASE);
    git("add", PAGE);
    git("commit", "-q", "-m", "start");
    head = git("rev-parse", "HEAD");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    mirror = new CheckoutStorage(dataDir).mirror("local", "docs");
    execFileSync("git", ["clone", "-q", "--bare", work, mirror]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    await subRole(admin, "wiki-publisher", ["wiki.write", "wiki.publish"]);
    ({ client: a } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: b } = await memberClient(app, admin, "editor-b", ["user", "wiki-editor"], ["shop"]));
    ({ client: publisher } = await memberClient(app, admin, "publisher-p", ["user", "wiki-publisher"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("publishes a draft nobody else touched: one write of kind page, the page's hash expected, the draft linked to it, audited", async () => {
    const textA = BASE.replace("Paragraph one.", "Paragraph one, by A.");
    const revision = await save(a, PAGE, textA, head);
    const first = await publish(a, { path: PAGE, revision, message: "A edits one\n\nLonger explanation.", minor: true });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ outcome: "published", write: { status: "queued", mode: "pull-request" } });
    const writeId = first.body.data!.write!.id;
    const data = await payload(writeId);
    expect(data).toMatchObject({ kind: "page", actor: "editor-a", message: "A edits one\n\nLonger explanation.", page: { id: null, path: PAGE, minor: true }, files: [{ path: PAGE, content: textA, expectedHash: sha256(BASE) }] });
    expect(data).not.toHaveProperty("directPublish");
    expect(data).not.toHaveProperty("continues");
    expect(data.files[0]).not.toHaveProperty("createOnly");
    expect((await a.get<Draft>(`/projects/shop/wiki/draft?path=${PAGE}`)).body.data?.writeId).toBe(writeId);
    expect(await audit("wiki-page.publish")).toEqual([{ path: PAGE, mode: "pull-request", writeId, pageId: null, username: "editor-a" }]);
    // The write lands: A's draft is done.
    await land(PAGE, textA, writeId);
    expect((await a.get(`/projects/shop/wiki/draft?path=${PAGE}`)).status).toBe(404);
  });

  it("merges a draft whose base is older than the head: a preview first, never published, and the confirmed merge holds both changes", async () => {
    // B read the page before A's change landed (base = the first commit) and edited paragraph three.
    const base = (await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n;
    const textB = BASE.replace("Paragraph three.", "Paragraph three, by B.");
    const firstCommit = git("rev-list", "--max-parents=0", "HEAD");
    const revision = await save(b, PAGE, textB, firstCommit);
    const preview = await publish(b, { path: PAGE, revision });
    expect(preview.status).toBe(200);
    expect(preview.body.data?.outcome).toBe("merge-preview");
    const merged = BASE.replace("Paragraph one.", "Paragraph one, by A.").replace("Paragraph three.", "Paragraph three, by B.");
    expect(preview.body.data).toMatchObject({ merged, head: { commit: head, hash: sha256(BASE.replace("Paragraph one.", "Paragraph one, by A.")) }, base: { commit: firstCommit, hash: sha256(BASE) } });
    // Nothing was written by the preview.
    expect((await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n).toBe(base);
    // A confirmation against another head is a new preview, not a publish.
    const stale = await publish(b, { path: PAGE, revision, mergedFrom: { commit: firstCommit, hash: sha256(BASE) } });
    expect(stale.body.data?.outcome).toBe("merge-preview");
    // The person confirms what they saw.
    const confirmed = await publish(b, { path: PAGE, revision, mergedFrom: preview.body.data!.head });
    expect(confirmed.body.data).toMatchObject({ outcome: "published", write: { mode: "pull-request" } });
    const data = await payload(confirmed.body.data!.write!.id);
    expect(data.files).toEqual([{ path: PAGE, content: merged, expectedHash: preview.body.data!.head!.hash }]);
    await land(PAGE, merged, confirmed.body.data!.write!.id);
  });

  it("answers 409 conflict with the three texts when both changed the same lines, writes nothing, and publishes the resolution", async () => {
    const before = (await writes(PAGE)).length;
    const startCommit = head;
    const startText = (await a.get<{ content: string }>(`/projects/shop/documents/file?path=${PAGE}`)).body.data!.content;
    const textD = startText.replace("Paragraph two.", "Paragraph two, by D.");
    const textC = startText.replace("Paragraph two.", "Paragraph two, by C.");
    const revisionC = await save(a, PAGE, textC, startCommit);
    const revisionD = await save(b, PAGE, textD, startCommit);
    const landed = await publish(b, { path: PAGE, revision: revisionD });
    expect(landed.body.data?.outcome).toBe("published");
    await land(PAGE, textD, landed.body.data!.write!.id);

    const conflict = await publish(a, { path: PAGE, revision: revisionC });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ statusCode: 409, details: { code: "conflict", base: startText, ours: textC, theirs: textD, head: { commit: head, hash: sha256(textD) }, regions: [{ baseStart: expect.any(Number), baseEnd: expect.any(Number) }] } });
    expect((await writes(PAGE)).length).toBe(before + 1);

    // A resolution against the head the conflict showed is published as written, expecting that page.
    const resolved = startText.replace("Paragraph two.", "Paragraph two, by C and D.");
    const done = await publish(a, { path: PAGE, revision: revisionC, resolvedText: resolved, mergedFrom: { commit: head, hash: sha256(textD) } });
    expect(done.body.data).toMatchObject({ outcome: "published" });
    expect((await payload(done.body.data!.write!.id)).files).toEqual([{ path: PAGE, content: resolved, expectedHash: sha256(textD) }]);
    await land(PAGE, resolved, done.body.data!.write!.id);
  });

  it("does not take a resolution made against a page that has since changed: the conflict is shown again", async () => {
    const startText = (await a.get<{ content: string }>(`/projects/shop/documents/file?path=${PAGE}`)).body.data!.content;
    const revisionA = await save(a, PAGE, startText.replace("Paragraph one, by A.", "Paragraph one, by A2."), head);
    const other = await save(b, PAGE, startText.replace("Paragraph one, by A.", "Paragraph one, by B2."), head);
    const landed = await publish(b, { path: PAGE, revision: other });
    await land(PAGE, startText.replace("Paragraph one, by A.", "Paragraph one, by B2."), landed.body.data!.write!.id);
    const before = (await writes(PAGE)).length;
    const attempt = await publish(a, { path: PAGE, revision: revisionA, resolvedText: "my resolution", mergedFrom: { commit: head, hash: sha256("some older page") } });
    expect(attempt.status).toBe(409);
    expect(attempt.body).toMatchObject({ details: { code: "conflict" } });
    expect((await writes(PAGE)).length).toBe(before);
    await a.request("DELETE", `/projects/shop/wiki/draft?path=${PAGE}`);
  });

  it("reports unchanged when the draft is what the page already says, and writes nothing", async () => {
    const text = (await a.get<{ content: string }>(`/projects/shop/documents/file?path=${PAGE}`)).body.data!.content;
    const before = (await writes(PAGE)).length;
    const revision = await save(a, PAGE, text, head);
    const response = await publish(a, { path: PAGE, revision });
    expect(response.body.data).toEqual({ outcome: "unchanged" });
    expect((await writes(PAGE)).length).toBe(before);
    await a.request("DELETE", `/projects/shop/wiki/draft?path=${PAGE}`);
  });

  it("gives a page only one open write: a second person is refused naming the write and its pull request, the same person continues the branch", async () => {
    const path = "10-eng/open.md";
    const revisionA = await save(a, path, "# Open\n\nBy A.\n");
    const revisionB = await save(b, path, "# Open\n\nBy B.\n");
    const first = await publish(a, { path, revision: revisionA });
    expect(first.body.data?.outcome).toBe("published");
    const open = first.body.data!.write!.id;
    expect((await payload(open)).files).toEqual([{ path, content: "# Open\n\nBy A.\n", createOnly: true }]);
    // Still being processed: no branch yet; the other person waits.
    const waiting = await publish(b, { path, revision: revisionB });
    expect(waiting.status).toBe(409);
    expect(waiting.body).toMatchObject({ details: { code: "open-write", write: { id: open, author: "editor-a", prUrl: null } } });
    // On review: the other person is told where.
    await app.db.query("update workflow.document_write set status = 'pr-opened', branch = 'kintsugi/editor-a/open', pr_url = 'https://git.example.invalid/pull/9' where id = $1", [open]);
    const blocked = await publish(b, { path, revision: revisionB });
    expect(blocked.body).toMatchObject({ statusCode: 409, details: { code: "open-write", write: { id: open, author: "editor-a", prUrl: "https://git.example.invalid/pull/9" } } });
    expect(blocked.body.message).toContain("https://git.example.invalid/pull/9");
    // The author changes the page again: the same branch is continued, not a new write on top of the pull request.
    const next = await a.request<Draft>("PUT", "/projects/shop/wiki/draft", { body: { path, text: "# Open\n\nBy A, again.\n", baseRevision: revisionA } });
    const again = await publish(a, { path, revision: next.body.data!.revision });
    expect(again.body.data?.outcome).toBe("published");
    expect((await payload(again.body.data!.write!.id)).continues).toBe("kintsugi/editor-a/open");
    // Once the pull request is closed the page is free.
    await app.db.query("update workflow.document_write set status = 'closed' where page_path = $1", [path]);
    expect((await publish(b, { path, revision: revisionB })).body.data?.outcome).toBe("published");
  });

  it("never opens two writes for one page when two people publish at the same moment", async () => {
    const path = "10-eng/race.md";
    const revisionA = await save(a, path, "# Race\n\nBy A.\n");
    const revisionB = await save(b, path, "# Race\n\nBy B.\n");
    const [one, two] = await Promise.all([publish(a, { path, revision: revisionA }), publish(b, { path, revision: revisionB })]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect([one, two].find((response) => response.status === 409)?.body).toMatchObject({ details: { code: "open-write" } });
    expect(await writes(path)).toHaveLength(1);
  });

  it("publishes straight to the default branch only for a person with wiki.publish on a path of directPublishPaths", async () => {
    vi.spyOn(app.nest.get(WikiDirectPublish, { strict: false }), "globs").mockResolvedValue(["10-direct/**"]);
    const direct = "10-direct/page.md";
    const revision = await save(publisher, direct, "# Direct\n");
    const done = await publish(publisher, { path: direct, revision });
    expect(done.body.data).toMatchObject({ outcome: "published", write: { mode: "direct" } });
    expect(await payload(done.body.data!.write!.id)).toMatchObject({ directPublish: true, files: [{ path: direct, createOnly: true }] });
    expect(await audit("wiki-page.publish")).toContainEqual(expect.objectContaining({ path: direct, mode: "direct" }));
    // A path outside the globs, and a person without wiki.publish, go through a pull request.
    const outside = "10-eng/not-direct.md";
    const outsideRevision = await save(publisher, outside, "# Not direct\n");
    const viaPullRequest = await publish(publisher, { path: outside, revision: outsideRevision });
    expect(viaPullRequest.body.data).toMatchObject({ write: { mode: "pull-request" } });
    expect(await payload(viaPullRequest.body.data!.write!.id)).not.toHaveProperty("directPublish");
    const noRight = "10-direct/by-editor.md";
    const noRightRevision = await save(a, noRight, "# By editor\n");
    const byEditor = await publish(a, { path: noRight, revision: noRightRevision });
    expect(byEditor.body.data).toMatchObject({ write: { mode: "pull-request" } });
    expect(await payload(byEditor.body.data!.write!.id)).not.toHaveProperty("directPublish");
    vi.restoreAllMocks();
  });

  it("takes the page id from the front matter for the write", async () => {
    const path = "10-eng/with-id.md";
    const text = "---\nid: PAGE-SHOP-0042\ntitle: With id\n---\n\n# With id\n";
    const revision = await save(a, path, text);
    const done = await publish(a, { path, revision });
    expect((await payload(done.body.data!.write!.id)).page).toEqual({ id: "PAGE-SHOP-0042", path, minor: false });
    expect(await audit("wiki-page.publish")).toContainEqual(expect.objectContaining({ path, pageId: "PAGE-SHOP-0042" }));
  });

  it("refuses a person without the right, audited, and the other bad requests without a write", async () => {
    const before = (await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n;
    const refused = await publish(reader, { path: PAGE, revision: 1 });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ details: { refusal: { code: "permission" } } });
    expect((await audit("wiki-page.refused")).at(-1)).toMatchObject({ path: PAGE, code: "permission", operation: "publish", username: "reader-r" });
    expect((await publish(a, { path: "10-eng/no-draft.md", revision: 1 })).status).toBe(404);
    const revision = await save(a, "10-eng/rev.md", "# Rev\n");
    expect((await publish(a, { path: "10-eng/rev.md", revision: revision + 1 })).body).toMatchObject({ statusCode: 409, details: { code: "draft-revision", revision } });
    expect((await publish(a, { path: "10-eng/rev.md", revision, resolvedText: "x" })).status).toBe(400);
    expect((await publish(a, { path: "10-eng/rev.md", revision, message: "" })).status).toBe(400);
    expect((await publish(a, { path: "10-eng/rev.md", revision, message: "x".repeat(201) })).status).toBe(400);
    expect((await publish(a, { path: "restricted/x.md", revision })).status).toBe(400);
    expect((await publish(a, { path: "10-eng/_attachments/a.png", revision })).status).toBe(400);
    expect((await publish(a, { path: "10-eng/rev.md", revision, extra: true })).status).toBe(400);
    expect((await app.db.query<{ n: number }>("select count(*)::int as n from workflow.document_write")).rows[0]!.n).toBe(before);
  });

  it("takes a page of 5 MiB in a draft and a publish, and refuses one byte more; a body over 12 MB is 413 there and 4 MB elsewhere", async () => {
    const path = "10-eng/big.md";
    const fits = "x".repeat(5 * 1024 * 1024);
    const saved = await a.request<Draft>("PUT", "/projects/shop/wiki/draft", { body: { path, text: fits, baseRevision: null } });
    expect(saved.status).toBe(200);
    expect((await a.request("PUT", "/projects/shop/wiki/draft", { body: { path: "10-eng/big2.md", text: `${fits}x`, baseRevision: null } })).status).toBe(400);
    expect((await publish(a, { path, revision: 1, resolvedText: `${fits}x`, mergedFrom: { commit: head, hash: null } })).status).toBe(400);
    const tooBig = await a.request("PUT", "/projects/shop/wiki/draft", { body: { path: "10-eng/big3.md", text: "x".repeat(13 * 1024 * 1024), baseRevision: null } });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toMatchObject({ message: "The request body exceeds the 12 MB limit" });
    // Other routes keep the general limit.
    const other = await a.request("PUT", "/projects/shop/wiki", { body: { enabled: true, padding: "x".repeat(5 * 1024 * 1024) } });
    expect(other.status).toBe(413);
    expect(other.body).toMatchObject({ message: "The request body exceeds the 4 MB limit" });
    await a.request("DELETE", `/projects/shop/wiki/draft?path=${path}`);
  });
});
