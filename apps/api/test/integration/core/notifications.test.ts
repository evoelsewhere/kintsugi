// The inbox (ADR-0099 decision 3, migration 058): a person reads only their own notifications, only of projects they can
// open now; the page's title and path are looked up when they read, and a repeat of a notification is not a second one. The
// person's open stream is told when theirs changes, and nobody else's is.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { RepositoryStore } from "@kintsugi/orchestrator";
import { indexBrain } from "@kintsugi/orchestrator/brain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationService } from "#modules/core/notifications/index.js";
import { type Client, adminClient, currentUserId, grantProjectAccess, memberClient, startTestApp, type TestApp } from "../../support/app.js";
import { hasDatabase } from "../../support/database.js";

interface Inbox {
  items: Array<{ id: string; kind: string; projectId: string; projectName: string; page: { key: string; path: string; title: string } | null; actor: { username: string; displayName: string }; commentId?: string; at: string; read: boolean }>;
  unread: number;
}

/** Reads a person's event stream until `done` is satisfied by the text so far, or `timeoutMs` pass. */
async function readUntil(url: string, cookie: string, done: (text: string) => boolean, timeoutMs: number, onOpen?: () => Promise<void>): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let text = "";
  try {
    const response = await fetch(url, { headers: { cookie, accept: "text/event-stream" }, signal: abort.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let opened = false;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
      if (!opened) {
        opened = true;
        void onOpen?.();
      }
      if (done(text)) break;
    }
  } catch {
    // The timeout aborted the read: what came is what there is.
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
  return text;
}

describe.skipIf(!hasDatabase)("notifications (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let dataDir: string;
  let work: string;
  let pool: pg.Pool;
  let notifications: NotificationService;
  let ada: Client;
  let adaId: string;
  let grace: Client;
  let graceId: string;
  let kim: Client;
  let kimId: string;
  const previousDataDir = process.env["KINTSUGI_DATA_DIR"];

  const git = (...args: string[]): string => execFileSync("git", args, { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Kim", GIT_AUTHOR_EMAIL: "kim@example.com", GIT_COMMITTER_NAME: "Kim", GIT_COMMITTER_EMAIL: "kim@example.com" } }).trim();
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(work, path)), { recursive: true });
    await writeFile(join(work, path), text);
    git("add", path);
  };
  const inbox = async (client: Client, query = ""): Promise<Inbox> => (await client.get<Inbox>(`/notifications${query}`)).body.data!;
  const make = (userId: string, key: string, over: Partial<{ projectId: string; kind: "wiki-page-changed" | "wiki-comment" | "wiki-mention"; subject: Record<string, unknown> }> = {}) =>
    notifications.create({ userId, projectId: over.projectId ?? "shop", kind: over.kind ?? "wiki-page-changed", subject: over.subject ?? { pageKey: "PAGE-ENG-0001", actorId: kimId, commit: "c".repeat(40) }, dedupeKey: key });

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-notify-"));
    process.env["KINTSUGI_DATA_DIR"] = dataDir;
    work = join(dataDir, "work");
    await mkdir(work);
    git("init", "-q", "-b", "main");
    await put("20-spaces/eng/guide.md", "---\nid: PAGE-ENG-0001\ntitle: Guide\n---\n\n# Guide\n\nSetup steps.\n");
    git("commit", "-q", "-m", "start");
    await mkdir(join(dataDir, "mirrors"), { recursive: true });
    execFileSync("git", ["clone", "-q", "--bare", work, new CheckoutStorage(dataDir).mirror("local", "docs")]);

    app = await startTestApp();
    notifications = app.nest.get(NotificationService, { strict: false });
    pool = new pg.Pool({ connectionString: app.db.url, max: 2 });
    admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('local', 'plain-git', 'Local', 'http://127.0.0.1:1', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('docs', 'local', 'http://127.0.0.1:1/docs.git', 'main')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, default_branch) values ('other-docs', 'local', 'http://127.0.0.1:1/other.git', 'main')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "docs" } })).status).toBe(201);
    expect((await admin.request("POST", "/admin/projects", { body: { id: "vault", name: "Vault", documentRepositoryId: "other-docs" } })).status).toBe(201);
    await grantProjectAccess(admin, "shop", await currentUserId(admin));
    ({ client: ada, id: adaId } = await memberClient(app, admin, "ada", ["user"], ["shop", "vault"]));
    ({ client: grace, id: graceId } = await memberClient(app, admin, "grace", ["user"], ["shop"]));
    ({ client: kim, id: kimId } = await memberClient(app, admin, "kim", ["user"], ["shop"]));
    expect((await admin.request("PUT", "/projects/shop/brain", { body: { enabled: true } })).status).toBe(200);
    await indexBrain({ pool, repositories: new RepositoryStore(pool), storage: new CheckoutStorage(dataDir), log: () => undefined }, "shop");
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["KINTSUGI_DATA_DIR"];
    else process.env["KINTSUGI_DATA_DIR"] = previousDataDir;
  });

  it("makes a notification once by its dedupe key, and refuses a subject that holds more than ids", async () => {
    expect(await make(adaId, "wiki-page-changed:ada:PAGE-ENG-0001:c1")).toBe(true);
    expect(await make(adaId, "wiki-page-changed:ada:PAGE-ENG-0001:c1")).toBe(false);
    const count = await app.db.query<{ count: string }>("select count(*)::text as count from core.notification where user_id = $1", [adaId]);
    expect(count.rows[0]?.count).toBe("1");
    await expect(make(adaId, "x1", { subject: { pageKey: "PAGE-ENG-0001", title: "Guide" } })).rejects.toThrow(/ids only/);
    await expect(make(adaId, "x2", { subject: { pageKey: "PAGE-ENG-0001", body: "the text of a comment" } })).rejects.toThrow(/ids only/);
    const stored = await app.db.query<{ subject: Record<string, unknown> }>("select subject from core.notification where user_id = $1", [adaId]);
    expect(Object.keys(stored.rows[0]?.subject ?? {}).sort()).toEqual(["actorId", "commit", "pageKey"]);
  });

  it("lists the caller's own notifications with the page's title and path from the Brain, who did it and the project's name", async () => {
    const list = await inbox(ada);
    expect(list.unread).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      kind: "wiki-page-changed",
      projectId: "shop",
      projectName: "Shop",
      page: { key: "PAGE-ENG-0001", path: "20-spaces/eng/guide.md", title: "Guide" },
      actor: { username: "kim" },
      read: false,
    });
    expect(list.items[0]?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await inbox(grace)).toEqual({ items: [], unread: 0 });
    expect((await ada.get<{ unread: number }>("/notifications/unread-count")).body.data).toEqual({ unread: 1 });
    expect((await grace.get<{ unread: number }>("/notifications/unread-count")).body.data).toEqual({ unread: 0 });
  });

  it("shows a notification whose page is gone without a page, and one without a known actor as someone", async () => {
    await make(adaId, "wiki-comment:ada:gone:-", { kind: "wiki-comment", subject: { pageKey: "PAGE-ENG-9999", commentId: "c9" } });
    const list = await inbox(ada);
    const gone = list.items.find((item) => item.kind === "wiki-comment");
    expect(gone).toMatchObject({ page: null, actor: { displayName: "Someone" }, commentId: "c9" });
  });

  it("leaves out the notifications of a project the caller cannot open now, in the list and in the count", async () => {
    await make(adaId, "wiki-mention:ada:vault:-", { projectId: "vault", kind: "wiki-mention", subject: { pageKey: "PAGE-VAULT-0001", actorId: kimId } });
    expect((await inbox(ada)).items.some((item) => item.projectId === "vault")).toBe(true);
    const before = (await inbox(ada)).unread;
    await app.db.query("delete from admin.project_access where project_id = 'vault' and user_id = $1", [adaId]);
    const after = await inbox(ada);
    expect(after.items.some((item) => item.projectId === "vault")).toBe(false);
    expect(after.unread).toBe(before - 1);
    expect((await ada.get<{ unread: number }>("/notifications/unread-count")).body.data?.unread).toBe(before - 1);
  });

  it("marks the caller's own read, by id or all, and never another person's", async () => {
    const mine = await inbox(ada);
    const id = mine.items[0]!.id;
    // Grace guessing Ada's id changes nothing of Ada's.
    expect((await grace.request("POST", "/notifications/read", { body: { ids: [id] } })).status).toBe(204);
    expect((await inbox(ada)).items.find((item) => item.id === id)?.read).toBe(false);
    expect((await ada.request("POST", "/notifications/read", { body: { ids: [id] } })).status).toBe(204);
    expect((await inbox(ada)).items.find((item) => item.id === id)?.read).toBe(true);
    expect((await inbox(ada, "?unread=true")).items.every((item) => !item.read)).toBe(true);
    expect((await ada.request("POST", "/notifications/read", { body: { all: true } })).status).toBe(204);
    expect((await inbox(ada)).unread).toBe(0);
    expect((await ada.request("POST", "/notifications/read", { body: { ids: ["not-a-uuid"] } })).status).toBe(400);
    expect((await ada.request("POST", "/notifications/read", { body: { all: false } })).status).toBe(400);
  });

  it("pages by time: newest first, `before` continues after the last one", async () => {
    for (let index = 0; index < 5; index += 1) {
      await make(graceId, `wiki-page-changed:grace:p${index}:c`, { subject: { pageKey: "PAGE-ENG-0001", actorId: kimId, commit: `${index}`.repeat(40) } });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const first = await inbox(grace, "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.unread).toBe(5);
    const second = await inbox(grace, `?limit=2&before=${encodeURIComponent(first.items[1]!.at)}`);
    expect(second.items).toHaveLength(2);
    const all = (await inbox(grace)).items.map((item) => item.id);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(all.slice(0, 4));
    expect((await grace.get("/notifications?limit=0")).status).toBe(400);
    expect((await grace.get("/notifications?before=yesterday")).status).toBe(400);
  });

  it("no route reads another person's notifications: the list and the count are the caller's own", async () => {
    const mineOfKim = await inbox(kim);
    expect(mineOfKim.items).toEqual([]);
    const response = await kim.get("/notifications?userId=" + graceId);
    expect(response.status).toBeLessThan(500);
    expect((await inbox(kim)).items).toEqual([]);
  });

  it("needs a session", async () => {
    expect((await fetch(`${app.baseUrl}/notifications`)).status).toBe(401);
    expect((await fetch(`${app.baseUrl}/notifications/unread-count`)).status).toBe(401);
  });

  it("tells the person's own stream that their notifications changed, and nobody else's", async () => {
    const aboutAda = (text: string): boolean => text.includes("notifications");
    // A notification for Ada: her stream hears of it...
    const hers = await readUntil(`${app.baseUrl}/events`, ada.cookie!, aboutAda, 5000, async () => {
      await make(adaId, "wiki-comment:ada:stream:-", { kind: "wiki-comment", subject: { pageKey: "PAGE-ENG-0001", commentId: "s1", actorId: kimId } });
    });
    expect(hers).toContain('"topic":"notifications"');
    expect(hers).toContain(`"scope":"${adaId}"`);
    // ...Grace's stream does not, though she is on the same installation.
    const graces = await readUntil(`${app.baseUrl}/events`, grace.cookie!, aboutAda, 2500, async () => {
      await make(adaId, "wiki-comment:ada:stream:2", { kind: "wiki-comment", subject: { pageKey: "PAGE-ENG-0001", commentId: "s2", actorId: kimId } });
    });
    expect(graces).not.toContain("notifications");
    expect(graces).not.toContain(adaId);
    // A repeat of a notification is not announced again.
    const repeat = await readUntil(`${app.baseUrl}/events`, ada.cookie!, aboutAda, 2500, async () => {
      await make(adaId, "wiki-comment:ada:stream:2", { kind: "wiki-comment", subject: { pageKey: "PAGE-ENG-0001", commentId: "s2", actorId: kimId } });
    });
    expect(repeat).not.toContain("notifications");
  });
});
