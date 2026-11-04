// Attachments of a draft (ADR-0098 decisions 2 and 9): a file or image added while editing is kept beside the caller's own
// draft only, checked (allowed type, bytes that are that type, size, a safe unique name), served back with fixed headers
// for the editor's preview, and published with the page as base64 files under its _attachments/ folder.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface View {
  name: string;
  contentType: string;
  size: number;
  markdown: string;
}
interface Payload {
  files: Array<{ path: string; content: string; encoding?: string; createOnly?: boolean; expectedHash?: string }>;
}

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 64): Buffer => Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(size - PNG_HEAD.length, 7)]);
const pdf = (): Buffer => Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF\n");
const PAGE = "10-eng/guide.md";
const NEW = "10-eng/new-page.md";
const FOLDER = "10-eng/_attachments";

describe.skipIf(!hasDatabase)("wiki attachments (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let editor: Client;
  let other: Client;
  let reader: Client;
  let head: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: join(dataDir, "work"), encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const attach = (client: Client, body: Record<string, unknown>) => client.request<View>("POST", "/projects/shop/wiki/draft/attachments", { body: { path: NEW, ...body } });
  const upload = (client: Client, name: string, bytes: Buffer, contentType: string, path = NEW) => attach(client, { path, name, contentType, contentBase64: bytes.toString("base64") });
  const list = async (client: Client, path = NEW) => (await client.get<View[]>(`/projects/shop/wiki/draft/attachments?path=${encodeURIComponent(path)}`)).body.data!;
  const raw = (client: Client, name: string, path = NEW) => fetch(`${app.baseUrl}/projects/shop/wiki/draft/attachments/file?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`, { headers: { cookie: client.cookie ?? "" } });
  const saveDraft = async (client: Client, path: string, text: string, baseCommit?: string): Promise<number> => {
    const response = await client.request<{ revision: number }>("PUT", "/projects/shop/wiki/draft", { body: { path, text, baseRevision: null, ...(baseCommit === undefined ? {} : { baseCommit }) } });
    expect(response.status, response.raw).toBe(200);
    return response.body.data!.revision;
  };
  const payload = async (writeId: string): Promise<Payload> => (await app.db.query<{ data: Payload }>("select data from pgboss.job where name = 'document-write' and data->>'writeId' = $1", [writeId])).rows[0]!.data;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-attach-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    for (const [path, content] of [
      [PAGE, "# Guide\n\nText.\n"],
      [`${FOLDER}/diagram.png`, png(32)],
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
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    await subRole(admin, "wiki-editor", ["wiki.write"]);
    ({ client: editor } = await memberClient(app, admin, "editor-a", ["user", "wiki-editor"], ["shop"]));
    ({ client: other } = await memberClient(app, admin, "editor-b", ["user", "wiki-editor"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
    await saveDraft(editor, NEW, "# New page\n");
    await saveDraft(other, NEW, "# Someone else's draft of the same page\n");
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("keeps an image for the draft, with a safe name, its type and the Markdown that shows it", async () => {
    const added = await upload(editor, "My Diagram (final).png", png(), "image/png");
    expect(added.status).toBe(201);
    expect(added.body.data).toEqual({ name: "My-Diagram-final.png", contentType: "image/png", size: 64, markdown: "![My-Diagram-final.png](_attachments/My-Diagram-final.png)" });
    const document = await upload(editor, "Plan.PDF", pdf(), "application/pdf");
    expect(document.body.data).toMatchObject({ name: "Plan.PDF", contentType: "application/pdf", markdown: "[Plan.PDF](_attachments/Plan.PDF)" });
    expect((await list(editor)).map((view) => view.name)).toEqual(["My-Diagram-final.png", "Plan.PDF"]);
  });

  it("gives a name that is taken, in the draft or already in the page's folder, a number", async () => {
    expect((await upload(editor, "My Diagram (final).png", png(), "image/png")).body.data?.name).toBe("My-Diagram-final-2.png");
    expect((await upload(editor, "my-diagram-final.PNG", png(), "image/png")).body.data?.name).toBe("my-diagram-final-3.PNG");
    // The folder of the page on the default branch has diagram.png.
    expect((await upload(editor, "diagram.png", png(), "image/png")).body.data?.name).toBe("diagram-2.png");
    expect((await upload(editor, "Diagram.png", png(), "image/png")).body.data?.name).toBe("Diagram-3.png");
  });

  it("serves a file back to its owner with a fixed type and no scripts: inline images, downloaded PDFs, nosniff, a sandbox", async () => {
    const image = await raw(editor, "My-Diagram-final.png");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("content-disposition")).toBe('inline; filename="My-Diagram-final.png"');
    expect(image.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await image.arrayBuffer()).equals(png())).toBe(true);
    const document = await raw(editor, "Plan.PDF");
    expect(document.headers.get("content-type")).toBe("application/pdf");
    expect(document.headers.get("content-disposition")).toBe('attachment; filename="Plan.PDF"');
    expect(Buffer.from(await document.arrayBuffer()).equals(pdf())).toBe(true);
  });

  it("shows nothing to anyone else: another editor's draft of the page has no such file", async () => {
    expect(await list(other)).toEqual([]);
    expect((await raw(other, "My-Diagram-final.png")).status).toBe(404);
    expect((await raw(reader, "My-Diagram-final.png")).status).toBe(404);
    expect((await other.request("DELETE", `/projects/shop/wiki/draft/attachments?path=${NEW}&name=My-Diagram-final.png`)).status).toBe(404);
    expect(await list(editor, "10-eng/no-draft.md")).toEqual([]);
  });

  it("refuses SVG, other types, bytes that are not what is claimed, empty and broken uploads, each with a 400", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const [name, bytes, contentType] of [
      ["vector.svg", svg, "image/svg+xml"],
      ["vector.png", svg, "image/png"],
      ["page.html", Buffer.from("<script>alert(1)</script>"), "text/html"],
      ["real.jpg", png(), "image/jpeg"],
      ["real.png", pdf(), "image/png"],
      ["claimed.png", png(), "application/pdf"],
      ["a.png.exe", png(), "image/png"],
    ] as const) {
      expect((await upload(editor, name, bytes, contentType)).status, `${name} ${contentType}`).toBe(400);
    }
    expect((await attach(editor, { name: "a.png", contentType: "image/png", contentBase64: "not base64!" })).status).toBe(400);
    expect((await attach(editor, { name: "a.png", contentType: "image/png", contentBase64: "" })).status).toBe(400);
    expect((await attach(editor, { name: "a.png", contentType: "image/png", contentBase64: png().toString("base64"), extra: 1 })).status).toBe(400);
    expect((await upload(editor, "a.png", png(), "image/png", "restricted/x.md")).status).toBe(400);
    expect((await upload(editor, "a.png", png(), "image/png", "10-eng/no-draft.md")).status).toBe(404);
    // A page in the root of the repository has no folder to hold files beside it.
    await saveDraft(editor, "root-page.md", "# Root\n");
    expect((await upload(editor, "a.png", png(), "image/png", "root-page.md")).status).toBe(400);
  });

  it("takes 5 MiB a file and 20 MiB a draft, and refuses one byte more of either with a 413", async () => {
    await app.db.query("delete from knowledge.wiki_draft_attachment");
    const MiB = 1024 * 1024;
    expect((await upload(editor, "limit.png", png(5 * MiB), "image/png")).status).toBe(201);
    expect((await upload(editor, "over.png", png(5 * MiB + 1), "image/png")).status).toBe(413);
    for (const name of ["two.png", "three.png", "four.png"]) expect((await upload(editor, name, png(5 * MiB), "image/png")).status, name).toBe(201);
    // 20 MiB held: not one byte more.
    const full = await upload(editor, "full.png", png(64), "image/png");
    expect(full.status).toBe(413);
    expect(full.body).toMatchObject({ message: expect.stringContaining("20 MiB") });
    // The body of this route may be 8 MB; any more is refused before it is read.
    const huge = await attach(editor, { name: "huge.png", contentType: "image/png", contentBase64: "A".repeat(9 * MiB) });
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ message: "The request body exceeds the 8 MB limit" });
    await app.db.query("delete from knowledge.wiki_draft_attachment");
  });

  it("removes a file from the draft, 204 once and 404 after", async () => {
    await upload(editor, "gone.png", png(), "image/png");
    expect((await editor.request("DELETE", `/projects/shop/wiki/draft/attachments?path=${NEW}&name=gone.png`)).status).toBe(204);
    expect((await editor.request("DELETE", `/projects/shop/wiki/draft/attachments?path=${NEW}&name=gone.png`)).status).toBe(404);
    expect((await list(editor)).map((view) => view.name)).not.toContain("gone.png");
  });

  it("needs Project Access, administrators included, and wiki.write to add or remove; a reader may only look", async () => {
    const { client: outsider } = await memberClient(app, admin, "outsider-o", ["user", "wiki-editor"], []);
    await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(admin)]);
    for (const client of [outsider, admin]) {
      expect((await upload(client, "a.png", png(), "image/png")).status).toBe(403);
      expect((await client.get(`/projects/shop/wiki/draft/attachments?path=${NEW}`)).status).toBe(403);
      expect((await client.request("DELETE", `/projects/shop/wiki/draft/attachments?path=${NEW}&name=a.png`)).status).toBe(403);
      expect((await raw(client, "a.png")).status).toBe(403);
    }
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    const refused = await upload(reader, "a.png", png(), "image/png");
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("wiki.write");
    expect((await reader.request("DELETE", `/projects/shop/wiki/draft/attachments?path=${NEW}&name=a.png`)).status).toBe(403);
    expect(await list(reader)).toEqual([]);
  });

  it("publishes the draft's files with the page, as base64 new files under the page's _attachments/ folder, bytes unchanged", async () => {
    await app.db.query("delete from knowledge.wiki_draft_attachment");
    const original = png(300);
    const added = (await upload(editor, "figure one.png", original, "image/png")).body.data!;
    const doc = (await upload(editor, "spec.pdf", pdf(), "application/pdf")).body.data!;
    const draft = await editor.get<{ revision: number }>(`/projects/shop/wiki/draft?path=${NEW}`);
    const published = await editor.request<{ outcome: string; write: { id: string } }>("POST", "/projects/shop/wiki/publish", { body: { path: NEW, revision: draft.body.data!.revision, message: "Add the page" } });
    expect(published.body.data?.outcome).toBe("published");
    const data = await payload(published.body.data!.write.id);
    expect(data.files.map((file) => file.path)).toEqual([NEW, `${FOLDER}/${added.name}`, `${FOLDER}/${doc.name}`]);
    expect(data.files[0]).toMatchObject({ createOnly: true });
    expect(data.files[1]).toEqual({ path: `${FOLDER}/figure-one.png`, content: original.toString("base64"), encoding: "base64", createOnly: true });
    expect(Buffer.from(data.files[1]!.content, "base64").equals(original)).toBe(true);
    expect(Buffer.from(data.files[2]!.content, "base64").equals(pdf())).toBe(true);
    // The write lands: the draft goes, and its files with it.
    await app.db.query("update workflow.document_write set status = 'merged', branch = 'kintsugi/x' where id = $1", [published.body.data!.write.id]);
    expect((await editor.get(`/projects/shop/wiki/draft?path=${NEW}`)).status).toBe(404);
    expect((await app.db.query("select 1 from knowledge.wiki_draft_attachment")).rowCount).toBe(0);
  });

  it("publishes only the files when the page text is what the page already says", async () => {
    const text = "# Guide\n\nText.\n";
    const revision = await saveDraft(other, PAGE, text, head);
    await upload(other, "extra.png", png(), "image/png", PAGE);
    const done = await other.request<{ outcome: string; write: { id: string } }>("POST", "/projects/shop/wiki/publish", { body: { path: PAGE, revision, message: "Add a figure" } });
    expect(done.body.data?.outcome).toBe("published");
    expect((await payload(done.body.data!.write.id)).files).toEqual([{ path: `${FOLDER}/extra.png`, content: png().toString("base64"), encoding: "base64", createOnly: true }]);
    // Without a file there is nothing to publish.
    await app.db.query("delete from workflow.document_write where id = $1", [done.body.data!.write.id]);
    await app.db.query("delete from knowledge.wiki_draft_attachment");
    await app.db.query("update knowledge.wiki_draft set write_id = null");
    expect((await other.request<{ outcome: string }>("POST", "/projects/shop/wiki/publish", { body: { path: PAGE, revision, message: "Nothing" } })).body.data?.outcome).toBe("unchanged");
  });
});
