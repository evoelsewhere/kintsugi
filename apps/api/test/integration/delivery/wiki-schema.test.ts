// The wiki's editing state (migration 056, delivery/wiki): the script runs twice without error, each table's adapter
// inserts, reads and deletes, and the rows go with the project.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WikiAttachments, WikiDrafts, WikiIdCounters, WikiRestrictions } from "#modules/delivery/wiki/index.js";
import { type Client, adminClient, currentUserId, memberClient, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

const MIGRATION = resolve(import.meta.dirname, "../../../migrations/056_wiki_edit.sql");

describe.skipIf(!hasDatabase)("wiki editing state (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let userId: string;
  let drafts: WikiDrafts;
  let attachments: WikiAttachments;
  let counters: WikiIdCounters;
  let restrictions: WikiRestrictions;

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    userId = await currentUserId(admin);
    await app.db.query("insert into admin.project (id, name) values ('shop', 'Shop'), ('shop-two', 'Shop two')");
    drafts = app.nest.get(WikiDrafts, { strict: false });
    attachments = app.nest.get(WikiAttachments, { strict: false });
    counters = app.nest.get(WikiIdCounters, { strict: false });
    restrictions = app.nest.get(WikiRestrictions, { strict: false });
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it("runs again without error and creates the editing tables (the watch and notify tables of migration 058 are beside them)", async () => {
    const script = await readFile(MIGRATION, "utf8");
    await app.db.query(script);
    await app.db.query(script);
    const tables = await app.db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'knowledge' and table_name like 'wiki\\_%' order by 1");
    expect(tables.rows.map((row) => row.table_name)).toEqual(["wiki_draft", "wiki_draft_attachment", "wiki_id_counter", "wiki_notify_cursor", "wiki_restriction", "wiki_watch"]);
  });

  it("hands out page-id numbers one by one per project and scope", async () => {
    expect(await Promise.all([1, 2, 3, 4, 5].map(() => counters.next("shop", "PAGE-SHOP")))).toSatisfy((numbers: number[]) => [...numbers].sort((a, b) => a - b).join() === "1,2,3,4,5");
    expect(await counters.next("shop", "PAGE-SHOP")).toBe(6);
    expect(await counters.next("shop", "OTHER")).toBe(1);
    expect(await counters.next("shop-two", "PAGE-SHOP")).toBe(1);
    expect((await app.db.query("select next from knowledge.wiki_id_counter where project_id = 'shop' and scope = 'PAGE-SHOP'")).rows[0]).toEqual({ next: 7 });
    await expect(app.db.query("insert into knowledge.wiki_id_counter (project_id, scope, next) values ('shop', 'ZERO', 0)")).rejects.toThrow(/check constraint/);
    await expect(app.db.query("insert into knowledge.wiki_id_counter (project_id, scope) values ('nobody', 'X')")).rejects.toThrow(/foreign key/);
  });

  it("keeps a draft per person and page: create, read, update by revision, list, others, delete", async () => {
    const created = await drafts.create({ projectId: "shop", userId, path: "01-standards/naming.md", pageId: "PAGE-SHOP-0001", text: "# Naming\n", baseCommit: "a".repeat(40), baseHash: "b".repeat(64) });
    expect(created).toMatchObject({ projectId: "shop", userId, path: "01-standards/naming.md", pageId: "PAGE-SHOP-0001", text: "# Naming\n", baseCommit: "a".repeat(40), baseHash: "b".repeat(64), revision: 1, writeId: null });
    expect(await drafts.find("shop", userId, "01-standards/naming.md")).toEqual(created);
    expect(await drafts.find("shop", userId, "01-standards/other.md")).toBeUndefined();
    await expect(drafts.create({ projectId: "shop", userId, path: "01-standards/naming.md", pageId: null, text: "again", baseCommit: null, baseHash: null })).rejects.toThrow(/duplicate key/);

    const updated = await drafts.update(created.id, 1, "# Naming\n\nMore.\n");
    expect(updated).toMatchObject({ id: created.id, revision: 2, text: "# Naming\n\nMore.\n" });
    expect(Date.parse(updated!.touchedAt)).toBeGreaterThanOrEqual(Date.parse(created.touchedAt));
    expect(await drafts.update(created.id, 1, "stale")).toBeUndefined();
    expect((await drafts.find("shop", userId, "01-standards/naming.md"))?.text).toBe("# Naming\n\nMore.\n");

    await drafts.setWrite(created.id, "write-1");
    expect((await drafts.find("shop", userId, "01-standards/naming.md"))?.writeId).toBe("write-1");
    await drafts.setWrite(created.id, null);
    expect((await drafts.find("shop", userId, "01-standards/naming.md"))?.writeId).toBeNull();

    const { id: otherId } = await memberClient(app, admin, "wiki-schema-other", ["user"], ["shop"]);
    await drafts.create({ projectId: "shop", userId: otherId, path: "01-standards/naming.md", pageId: null, text: "theirs", baseCommit: null, baseHash: null });
    expect((await drafts.listOf("shop", userId)).map((draft) => draft.path)).toEqual(["01-standards/naming.md"]);
    expect(await drafts.othersOn("shop", "01-standards/naming.md", userId, new Date(Date.now() - 120_000).toISOString())).toEqual([{ userId: otherId, name: "wiki-schema-other", touchedAt: expect.any(String) }]);
    expect(await drafts.othersOn("shop", "01-standards/naming.md", userId, new Date(Date.now() + 60_000).toISOString())).toEqual([]);

    expect(await drafts.remove(created.id)).toBe(true);
    expect(await drafts.remove(created.id)).toBe(false);
    expect(await drafts.find("shop", userId, "01-standards/naming.md")).toBeUndefined();
    await expect(app.db.query("update knowledge.wiki_draft set revision = 0")).rejects.toThrow(/check constraint/);
    await expect(drafts.create({ projectId: "shop", userId, path: "big.md", pageId: null, text: "x".repeat(5 * 1024 * 1024 + 1), baseCommit: null, baseHash: null })).rejects.toThrow(/check constraint/);
  });

  it("attaches files to a draft, replaces one of the same name, and drops them with the draft", async () => {
    const draft = await drafts.create({ projectId: "shop", userId, path: "with-files.md", pageId: null, text: "# Files\n", baseCommit: null, baseHash: null });
    expect(await attachments.put(draft.id, { name: "diagram.png", contentType: "image/png", bytes: Buffer.from([1, 2, 3]) })).toEqual({ name: "diagram.png", contentType: "image/png", size: 3 });
    await attachments.put(draft.id, { name: "a.txt", contentType: "text/plain", bytes: Buffer.from("hello") });
    expect(await attachments.list(draft.id)).toEqual([
      { name: "a.txt", contentType: "text/plain", size: 5 },
      { name: "diagram.png", contentType: "image/png", size: 3 },
    ]);
    await attachments.put(draft.id, { name: "a.txt", contentType: "text/plain", bytes: Buffer.from("replaced!") });
    expect((await attachments.read(draft.id, "a.txt"))?.bytes.toString()).toBe("replaced!");
    expect((await attachments.list(draft.id)).find((file) => file.name === "a.txt")?.size).toBe(9);
    expect(await attachments.read(draft.id, "nothing.txt")).toBeUndefined();
    expect(await attachments.remove(draft.id, "diagram.png")).toBe(true);
    expect(await attachments.remove(draft.id, "diagram.png")).toBe(false);
    await drafts.remove(draft.id);
    expect((await app.db.query("select 1 from knowledge.wiki_draft_attachment where draft_id = $1", [draft.id])).rowCount).toBe(0);
  });

  it("keeps restrictions by prefix and finds the ones that cover a path", async () => {
    const add = (pathPrefix: string, subjectId: string, kind: "edit" | "publish" = "edit", subjectKind: "user" | "role" = "role") => restrictions.add({ projectId: "shop", pathPrefix, subjectKind, subjectId, kind, createdBy: userId });
    const first = await add("01-standards/", "architect");
    expect(await add("01-standards/", "architect")).toMatchObject({ id: first.id });
    await add("01-standards/", userId, "edit", "user");
    await add("01-standards/naming.md", "editor");
    await add("01-standards/naming.md", "lead", "publish");
    await add("01-standards-extra/", "nobody");
    await add("02-architecture/", "architect");
    expect((await restrictions.list("shop")).map((row) => `${row.pathPrefix}:${row.kind}:${row.subjectKind}`)).toEqual([
      "01-standards-extra/:edit:role",
      "01-standards/:edit:role",
      "01-standards/:edit:user",
      "01-standards/naming.md:edit:role",
      "01-standards/naming.md:publish:role",
      "02-architecture/:edit:role",
    ]);
    // A folder prefix covers what is under it, a file prefix only that file, a similar name nothing.
    expect((await restrictions.covering("shop", "01-standards/naming.md")).map((row) => `${row.pathPrefix}:${row.kind}`)).toEqual(["01-standards/:edit", "01-standards/:edit", "01-standards/naming.md:edit", "01-standards/naming.md:publish"]);
    expect((await restrictions.covering("shop", "01-standards/deep/er/page.md")).map((row) => row.pathPrefix)).toEqual(["01-standards/", "01-standards/"]);
    expect(await restrictions.covering("shop", "01-standards.md")).toEqual([]);
    expect(await restrictions.covering("shop-two", "01-standards/naming.md")).toEqual([]);

    expect(await restrictions.clear("shop", "01-standards/", "edit")).toBe(2);
    expect(await restrictions.clear("shop", "01-standards/", "edit")).toBe(0);
    expect((await restrictions.covering("shop", "01-standards/naming.md")).map((row) => `${row.pathPrefix}:${row.kind}`)).toEqual(["01-standards/naming.md:edit", "01-standards/naming.md:publish"]);
    await expect(app.db.query("insert into knowledge.wiki_restriction (project_id, path_prefix, subject_kind, subject_id, kind) values ('shop', '/abs', 'user', 'u', 'edit')")).rejects.toThrow(/check constraint/);
    await expect(app.db.query("insert into knowledge.wiki_restriction (project_id, path_prefix, subject_kind, subject_id, kind) values ('shop', 'a/', 'group', 'u', 'edit')")).rejects.toThrow(/check constraint/);
    await expect(app.db.query("insert into knowledge.wiki_restriction (project_id, path_prefix, subject_kind, subject_id, kind) values ('shop', 'a/', 'user', 'u', 'delete')")).rejects.toThrow(/check constraint/);
  });

  it("answers the access route for people with Project Access only", async () => {
    const { client: reader } = await memberClient(app, admin, "wiki-schema-reader", ["user"], ["shop"]);
    const response = await reader.get("/projects/shop/wiki/access?path=01-standards%2Fnaming.md");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ path: "01-standards/naming.md", editable: true, canWrite: false, canPublish: false, direct: false, refusal: { code: "permission" }, pending: null });
    expect((await reader.get("/projects/shop/wiki/access")).status).toBe(400);
    const { client: outsider } = await memberClient(app, admin, "wiki-schema-outsider", ["user"], []);
    expect((await outsider.get("/projects/shop/wiki/access?path=a.md")).status).toBe(403);
    expect((await admin.get("/projects/shop/wiki/access?path=a.md")).status).toBe(403);
  });

  it("removes every row of the project with it", async () => {
    const draft = await drafts.create({ projectId: "shop-two", userId, path: "gone.md", pageId: null, text: "x", baseCommit: null, baseHash: null });
    await attachments.put(draft.id, { name: "f.bin", contentType: "application/octet-stream", bytes: Buffer.from("x") });
    await restrictions.add({ projectId: "shop-two", pathPrefix: "a/", subjectKind: "user", subjectId: userId, kind: "edit", createdBy: null });
    await app.db.query("delete from admin.project where id = 'shop-two'");
    for (const table of ["wiki_draft", "wiki_draft_attachment", "wiki_id_counter", "wiki_restriction"]) {
      const rows = await app.db.query(table === "wiki_draft_attachment" ? "select 1 from knowledge.wiki_draft_attachment where draft_id = $1" : `select 1 from knowledge.${table} where project_id = 'shop-two'`, table === "wiki_draft_attachment" ? [draft.id] : []);
      expect(rows.rowCount, table).toBe(0);
    }
  });
});
