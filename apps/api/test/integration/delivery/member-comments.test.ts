// The comments of a wiki page for a member's agent (P3-013, ADR-0099 decision 1, COL-07): one read of its own on the member
// API, never part of a Brain answer; the same guards as the other member reads (token scope, Project Access, member.read).
// The document repo is a real mirror and the Brain is built by the worker's own function.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../../src/common/domain/ids.js";
import { hashToken } from "../../../src/common/security/token-hash.js";
import { MEMBER_TOKEN_PREFIX } from "../../../src/modules/core/auth/application/member-token.service.js";
import { Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, subRole, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface MemberComment {
  id: string;
  parentId: string | null;
  author: Record<string, unknown>;
  body: string;
  resolved: boolean;
  deleted: boolean;
  node: string | null;
  status: string;
  line: number | null;
  quote: string | null;
}
interface MemberComments {
  schemaVersion: string;
  projectId: string;
  page: { key: string; path: string };
  comments: MemberComment[];
  truncated: boolean;
}

const GUIDE = "20-spaces/eng/guide.md";
const GUIDE_TEXT = "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\nIntroduction before any heading.\n\n## Setup\n\nInstall the package first, then run the setup script twice.\n\n## Usage\n\nCall the service with a token.\n";
const SECRET_WORD = "zebracomment";

describe.skipIf(!hasDatabase)("member comments (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let pool: pg.Pool;
  let ada: Client;
  let adaToken: string;
  let outsiderToken: string;
  let otherProjectToken: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" } }).trim();
  const bearer = (token: string, headers: Record<string, string> = {}) => ({ csrf: false, headers: { authorization: `Bearer ${token}`, ...headers } });
  const post = (body: Record<string, unknown>) => ada.request<{ id: string }>("POST", "/projects/shop/wiki/comments", { body: { path: GUIDE, ...body } });
  const read = (token: string, query: string, headers: Record<string, string> = {}) => new Client(app).request<MemberComments>("GET", `/member/v1/comments?${query}`, bearer(token, headers));
  const ids = { whole: "", inline: "", reply: "", resolved: "", deletedWithReply: "", deletedReply: "" };

  async function tokenFor(userId: string, projects: string[]): Promise<string> {
    const token = MEMBER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const tokenId = newId();
    await app.db.query("insert into core.member_token (id, user_id, name, token_hash, expires_at) values ($1, $2, 'test', $3, $4)", [tokenId, userId, hashToken(token), new Date(Date.now() + 120_000)]);
    for (const project of projects) await app.db.query("insert into core.member_token_project (token_id, project_id) values ($1, $2)", [tokenId, project]);
    return token;
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-member-comments-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    const work = join(dataDir, "work");
    await mkdir(work);
    git(work, "init", "-q", "-b", "main");
    await mkdir(dirname(join(work, GUIDE)), { recursive: true });
    await writeFile(join(work, GUIDE), GUIDE_TEXT);
    git(work, "add", GUIDE);
    git(work, "commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('other-docs', 'local', 'http://127.0.0.1:1/other-docs.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "other", name: "Other", documentRepositoryId: "other-docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    expect(await indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop")).toMatchObject({ status: "built" });

    await app.db.query("insert into core.role_permission (role_id, permission_code) values ('user', 'member.read') on conflict do nothing");
    await subRole(admin, "wiki-commenter", ["wiki.comment"]);
    let adaId: string;
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user", "wiki-commenter"], ["shop", "other"]));
    const outsider = await memberClient(app, admin, "outsider", ["user"], []);
    adaToken = await tokenFor(adaId, ["shop"]);
    outsiderToken = await tokenFor(outsider.id, ["shop"]);
    otherProjectToken = await tokenFor(adaId, ["other"]);

    // A page's comments: one on the whole page, an inline one with an answer, a resolved thread, a deleted one that still has an answer.
    ids.whole = (await post({ body: `A question about the whole page, ${SECRET_WORD}.` })).body.data!.id;
    ids.inline = (await post({ body: "Which package?", anchor: { node: "setup", exact: "Install the package first" } })).body.data!.id;
    ids.reply = (await post({ body: "The one in the lockfile.", parentId: ids.inline })).body.data!.id;
    ids.resolved = (await post({ body: "Typo in the usage section.", anchor: { node: "usage", exact: "Call the service with a token" } })).body.data!.id;
    ids.deletedWithReply = (await post({ body: "I will delete this." })).body.data!.id;
    ids.deletedReply = (await post({ body: "An answer to a comment that is gone.", parentId: ids.deletedWithReply })).body.data!.id;
    await app.db.query("update knowledge.wiki_comment set status = 'resolved', resolved_at = now() where id = $1", [ids.resolved]);
    await app.db.query("update knowledge.wiki_comment set deleted_at = now() where id = $1", [ids.deletedWithReply]);
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("gives the open threads of a page with their answers, the quote and where it is now, and no account id", async () => {
    const result = await read(adaToken, `projectId=shop&path=${encodeURIComponent(GUIDE)}`);
    expect(result.status, result.raw).toBe(200);
    expect(result.body.data).toMatchObject({ schemaVersion: "1", projectId: "shop", page: { key: "PAGE-ENG-0001", path: GUIDE }, truncated: false });
    // Open threads and their answers, in time order: the resolved thread and the deleted one (with its answer) are not.
    expect(result.body.data!.comments.map((comment) => comment.id)).toEqual([ids.whole, ids.inline, ids.reply]);
    const [whole, inline, reply] = result.body.data!.comments;
    expect(whole).toMatchObject({ parentId: null, node: null, quote: null, line: null, status: "anchored", resolved: false, deleted: false });
    expect(inline).toMatchObject({ parentId: null, node: "setup", quote: "Install the package first", status: "anchored", body: "Which package?" });
    expect(inline!.line).toBeGreaterThan(0);
    expect(reply).toMatchObject({ parentId: ids.inline, body: "The one in the lockfile." });
    // Only what a person is called: no account id, no email.
    for (const comment of result.body.data!.comments) expect(Object.keys(comment.author).sort()).toEqual(["displayName", "username"]);
    expect(result.raw).not.toContain("@example");
  });

  it("gives every comment with status=all, a deleted comment that still has an answer blank", async () => {
    const result = await read(adaToken, `projectId=shop&path=${encodeURIComponent(GUIDE)}&status=all`);
    expect(result.status).toBe(200);
    const byId = new Map(result.body.data!.comments.map((comment) => [comment.id, comment]));
    expect([...byId.keys()]).toEqual([ids.whole, ids.inline, ids.reply, ids.resolved, ids.deletedWithReply, ids.deletedReply]);
    expect(byId.get(ids.resolved)).toMatchObject({ resolved: true, quote: "Call the service with a token" });
    expect(byId.get(ids.deletedWithReply)).toMatchObject({ deleted: true, body: "" });
  });

  it("follows a passage that moved or is gone: the status says so, the quote stays", async () => {
    // The page now has the passage under another heading, and the usage passage is gone.
    const work = join(dataDir, "work");
    await writeFile(join(work, GUIDE), "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\nIntroduction before any heading.\n\n## Setup\n\nNothing here.\n\n## Usage\n\nInstall the package first, then run the setup script twice.\n");
    git(work, "commit", "-q", "-am", "move the passage");
    git(work, "push", "-q", new CheckoutStorage(dataDir).mirror("local", "docs"), "HEAD:main");
    expect(await indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop")).toMatchObject({ status: "built" });
    const result = await read(adaToken, `projectId=shop&path=${encodeURIComponent(GUIDE)}&status=all`);
    const byId = new Map(result.body.data!.comments.map((comment) => [comment.id, comment]));
    expect(byId.get(ids.inline)).toMatchObject({ status: "moved", node: "usage", quote: "Install the package first" });
    expect(byId.get(ids.resolved)).toMatchObject({ status: "orphaned", line: null, quote: "Call the service with a token" });
  });

  it("is never part of a Brain answer: no Brain read holds a word of a comment", async () => {
    const answers = await Promise.all(
      [
        `brain/tree?projectId=shop`,
        `brain/read?projectId=shop&node=${encodeURIComponent(GUIDE)}&scope=node`,
        `brain/read?projectId=shop&node=${encodeURIComponent(`${GUIDE}#setup`)}`,
        `brain/lookup?projectId=shop&query=${encodeURIComponent(GUIDE)}`,
        `brain/backlinks?projectId=shop&node=${encodeURIComponent(GUIDE)}`,
        `brain/grep?projectId=shop&text=${SECRET_WORD}`,
      ].map(async (path) => new Client(app).request("GET", `/member/v1/${path}`, bearer(adaToken))),
    );
    for (const [index, answer] of answers.entries()) {
      expect(answer.status, answer.raw).toBe(200);
      // The grep answer repeats the words searched for; the others hold none of a comment's.
      if (index !== 5) expect(answer.raw).not.toContain(SECRET_WORD);
      expect(answer.raw).not.toContain("Which package?");
    }
    // The grep for a word only a comment holds finds nothing, and the Brain's rows hold no comment.
    expect(JSON.parse(answers[5]!.raw)).toMatchObject({ data: { matches: [] } });
    expect((await app.db.query("select 1 from knowledge.brain_node where summary ilike $1 or title ilike $1", [`%${SECRET_WORD}%`])).rowCount).toBe(0);
  });

  it("keeps the guards of the other member reads: a token, its projects, Project Access, a page, the query", async () => {
    const path = `projectId=shop&path=${encodeURIComponent(GUIDE)}`;
    expect((await new Client(app).request("GET", `/member/v1/comments?${path}`, { csrf: false })).status).toBe(401);
    expect((await read(otherProjectToken, path)).status).toBe(403); // the token covers another project
    expect((await read(outsiderToken, path)).status).toBe(403); // no Project Access on the project
    expect((await read(adaToken, `projectId=shop&path=${encodeURIComponent("20-spaces/eng/nothing.md")}`)).status).toBe(404);
    expect((await read(adaToken, `${path}&status=resolved`)).status).toBe(400);
    expect((await read(adaToken, `${path}&extra=1`)).status).toBe(400);
    expect((await read(adaToken, "projectId=shop")).status).toBe(400);
    // The features header changes nothing about a comment: the shape is the same with it.
    const plain = await read(adaToken, path);
    const asking = await read(adaToken, path, { "kintsugi-member-features": "page-attributes" });
    expect(asking.body.data).toEqual(plain.body.data);
  });

  it("gives the first 500 comments of a page and says there are more", async () => {
    const page = (await app.db.query<{ page_key: string; path_at_write: string; author_id: string }>("select page_key, path_at_write, author_id from knowledge.wiki_comment where id = $1", [ids.whole])).rows[0]!;
    await app.db.query(
      `insert into knowledge.wiki_comment (project_id, page_key, path_at_write, author_id, body, created_at)
       select 'shop', $1, $2, $3, 'bulk ' || n, now() + (n || ' seconds')::interval from generate_series(1, 520) as n`,
      [page.page_key, page.path_at_write, page.author_id],
    );
    // The page allows 200 open comments when one is written; rows made another way are listed all the same, up to the answer's bound.
    const result = await read(adaToken, `projectId=shop&path=${encodeURIComponent(GUIDE)}`);
    expect(result.status).toBe(200);
    expect(result.body.data!.comments).toHaveLength(500);
    expect(result.body.data!.truncated).toBe(true);
  });
});
