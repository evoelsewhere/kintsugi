// Changing and deleting comments (P3-012, ADR-0099 decisions 5 and 7): anyone with wiki.comment resolves and reopens, only
// the author edits, the author deletes while nobody has answered and someone with wiki.manage deletes any comment, which
// is audited without its text; a deleted comment with answers stays as an empty marker.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface View {
  id: string;
  parentId: string | null;
  author: { username: string };
  body: string;
  editedAt: string | null;
  resolved: boolean;
  deleted: boolean;
}
interface List {
  comments: View[];
}

const GUIDE = "20-spaces/eng/guide.md";

describe.skipIf(!hasDatabase)("wiki comments: resolve, edit and delete (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let ada: Client;
  let adaId: string;
  let grace: Client;
  let moderator: Client;
  let moderatorId: string;
  let reader: Client;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const post = (client: Client, body: string, parentId?: string) => client.request<View>("POST", "/projects/shop/wiki/comments", { body: { path: GUIDE, body, ...(parentId === undefined ? {} : { parentId }) } });
  const patch = (client: Client, id: string, body: Record<string, unknown>) => client.request<View>("PATCH", `/projects/shop/wiki/comments/${id}`, { body });
  const remove = (client: Client, id: string) => client.request("DELETE", `/projects/shop/wiki/comments/${id}`);
  const list = async () => (await reader.get<List>(`/projects/shop/wiki/comments?path=${GUIDE}`)).body.data!.comments;
  const created = async (client: Client, body: string, parentId?: string) => (await post(client, body, parentId)).body.data!;
  const audit = async () => (await app.db.query<{ actor: string; subject: string | null; detail: Record<string, unknown> }>("select actor, subject, detail from governance.audit_event where action = 'wiki-comment.delete' order by id")).rows;
  const row = async (id: string) => (await app.db.query<{ body: string; deleted_at: Date | null; status: string; resolved_by: string | null; edited_at: Date | null }>("select body, deleted_at, status, resolved_by, edited_at from knowledge.wiki_comment where id = $1", [id])).rows[0]!;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-commentchanges-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } });
    git("init", "-q", "-b", "main");
    await mkdir(dirname(join(work, GUIDE)), { recursive: true });
    await writeFile(join(work, GUIDE), "---\nid: PAGE-ENG-0001\n---\n\n# Guide\n\nText.\n");
    git("add", GUIDE);
    git("commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    await subRole(admin, "wiki-commenter", ["wiki.comment"]);
    await subRole(admin, "wiki-moderator", ["wiki.comment", "wiki.manage"]);
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user", "wiki-commenter"], ["shop"]));
    ({ client: grace } = await memberClient(app, admin, "grace", ["user", "wiki-commenter"], ["shop"]));
    ({ client: moderator, id: moderatorId } = await memberClient(app, admin, "mod-m", ["user", "wiki-moderator"], ["shop"]));
    ({ client: reader } = await memberClient(app, admin, "reader-r", ["user"], ["shop"]));
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("lets anyone with wiki.comment resolve and reopen a comment, who resolved it kept while it is", async () => {
    const comment = await created(ada, "Is this right?");
    const resolved = await patch(grace, comment.id, { resolved: true });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ id: comment.id, resolved: true, deleted: false, body: "Is this right?" });
    expect(await row(comment.id)).toMatchObject({ status: "resolved", resolved_by: expect.any(String) });
    expect((await list()).find((entry) => entry.id === comment.id)?.resolved).toBe(true);
    // Resolving what is resolved changes nothing; reopening clears who resolved it.
    expect((await patch(grace, comment.id, { resolved: true })).body.data?.resolved).toBe(true);
    expect((await patch(ada, comment.id, { resolved: false })).body.data?.resolved).toBe(false);
    expect(await row(comment.id)).toMatchObject({ status: "open", resolved_by: null });
    // An answer is resolved with the comment it answers.
    const answer = await created(grace, "An answer.", comment.id);
    expect((await patch(ada, answer.id, { resolved: true })).status).toBe(400);
  });

  it("lets only the author edit the text, and marks it edited", async () => {
    const comment = await created(ada, "Original words.");
    const edited = await patch(ada, comment.id, { body: "  Better words.  " });
    expect(edited.body.data).toMatchObject({ body: "Better words.", resolved: false });
    expect(edited.body.data?.editedAt).not.toBeNull();
    expect((await row(comment.id)).edited_at).not.toBeNull();
    const refused = await patch(grace, comment.id, { body: "Not mine." });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("author");
    expect((await patch(moderator, comment.id, { body: "Not even a moderator's." })).status).toBe(403);
    expect((await patch(ada, comment.id, { body: "   " })).status).toBe(400);
    expect((await patch(ada, comment.id, { body: "x".repeat(8001) })).status).toBe(400);
    // Text and state may change together.
    const both = await patch(ada, comment.id, { body: "Both.", resolved: true });
    expect(both.body.data).toMatchObject({ body: "Both.", resolved: true });
    expect((await row(comment.id)).body).toBe("Both.");
  });

  it("refuses a change that changes nothing, an unknown key, an unknown or deleted comment, and a person without the right", async () => {
    const comment = await created(ada, "To refuse.");
    expect((await patch(ada, comment.id, {})).status).toBe(400);
    expect((await patch(ada, comment.id, { resolved: true, extra: 1 })).status).toBe(400);
    expect((await patch(ada, "00000000-0000-4000-8000-000000000000", { resolved: true })).status).toBe(404);
    expect((await patch(ada, "not-a-uuid", { resolved: true })).status).toBe(404);
    expect((await remove(ada, "not-a-uuid")).status).toBe(404);
    const refused = await patch(reader, comment.id, { resolved: true });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("wiki.comment");
    const { client: outsider } = await memberClient(app, admin, "outsider", ["user", "wiki-moderator"], []);
    for (const client of [outsider, admin]) {
      await app.db.query("delete from admin.project_access where project_id = 'shop' and user_id = $1", [await currentUserId(admin)]);
      expect((await patch(client, comment.id, { resolved: true })).status).toBe(403);
      expect((await remove(client, comment.id)).status).toBe(403);
    }
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
  });

  it("makes room for one more when a comment is resolved, and refuses to reopen onto a full page", async () => {
    await app.db.query("delete from knowledge.wiki_comment");
    await app.db.query("insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body) select 'shop', 'PAGE-ENG-0001', $2, $1, 'Comment ' || g from generate_series(1, 200) g", [adaId, GUIDE]);
    expect((await post(ada, "One too many.")).status).toBe(409);
    const first = (await app.db.query<{ id: string }>("select id from knowledge.wiki_comment where body = 'Comment 1'")).rows[0]!.id;
    expect((await patch(grace, first, { resolved: true })).status).toBe(200);
    expect((await post(ada, "Room now.")).status).toBe(201);
    const reopen = await patch(grace, first, { resolved: false });
    expect(reopen.status).toBe(409);
    expect(reopen.body).toMatchObject({ details: { code: "too-many", limit: 200 } });
    expect((await row(first)).status).toBe("resolved");
    await app.db.query("delete from knowledge.wiki_comment");
  });

  it("lets the author delete a comment nobody has answered: it goes from the list and its text from the row; no audit entry", async () => {
    const before = (await audit()).length;
    const comment = await created(ada, "Delete me, I am wrong.");
    expect((await remove(grace, comment.id)).status).toBe(403);
    expect((await remove(ada, comment.id)).status).toBe(204);
    expect(await row(comment.id)).toMatchObject({ body: "", deleted_at: expect.any(Date) });
    expect((await list()).some((entry) => entry.id === comment.id)).toBe(false);
    expect((await remove(ada, comment.id)).status).toBe(404);
    expect((await patch(ada, comment.id, { body: "Back from the dead." })).status).toBe(404);
    expect((await audit()).length).toBe(before);
  });

  it("refuses the author a comment that has answers, lets a moderator delete it, audits that without the text, and keeps an empty marker", async () => {
    const comment = await created(ada, "A thread with a secret phrase: ZEBRA-4711.");
    const answer = await created(grace, "A reply.", comment.id);
    const refused = await remove(ada, comment.id);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ details: { code: "has-replies" } });
    expect((await remove(moderator, comment.id)).status).toBe(204);
    const entries = await audit();
    expect(entries.at(-1)).toEqual({ actor: moderatorId, subject: comment.id, detail: { path: GUIDE, commentId: comment.id, authorId: adaId, username: "mod-m" } });
    expect(JSON.stringify(entries)).not.toContain("ZEBRA-4711");
    expect((await row(comment.id)).body).toBe("");
    const listed = await list();
    expect(listed.find((entry) => entry.id === comment.id)).toMatchObject({ deleted: true, body: "", author: { username: "ada" } });
    expect(listed.find((entry) => entry.id === answer.id)).toMatchObject({ body: "A reply.", parentId: comment.id });
    // The answer can still be deleted by its own author, and then the marker goes with it.
    expect((await remove(grace, answer.id)).status).toBe(204);
    expect((await list()).some((entry) => entry.id === comment.id || entry.id === answer.id)).toBe(false);
  });

  it("audits a moderator's delete of another person's comment only, not of their own", async () => {
    const before = (await audit()).length;
    const mine = await created(moderator, "My own comment.");
    expect((await remove(moderator, mine.id)).status).toBe(204);
    expect((await audit()).length).toBe(before);
    const theirs = await created(grace, "Someone else's.");
    expect((await remove(moderator, theirs.id)).status).toBe(204);
    expect((await audit()).length).toBe(before + 1);
  });
});
