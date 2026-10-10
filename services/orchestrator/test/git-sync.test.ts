// Git sync against a real git remote and a throwaway database: first clone, fetch of new
// commits, failures recorded on the repository, pruning, and the queue end to end.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptSecret } from "@kintsugi/secrets";
import { CheckoutStorage } from "@kintsugi/git";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { pruneMirrors, syncRepository } from "../src/git-sync/sync.js";
import { startWorker } from "../src/worker.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

describe.skipIf(!hasDatabase)("git sync (integration)", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let dataDir: string;
  let storage: CheckoutStorage;
  let deps: { store: RepositoryStore; storage: CheckoutStorage };

  const repository = async (id: string, url: string, serverId = "internal"): Promise<void> => {
    await db.pool.query("insert into admin.git_repository (id, server_id, url, default_branch) values ($1, $2, $3, 'main')", [id, serverId, url]);
  };
  const row = async (id: string) =>
    (await db.pool.query<{ sync_status: string; last_commit: string | null; last_error: string | null }>(
      "select sync_status, last_commit, last_error from admin.git_repository where id = $1",
      [id],
    )).rows[0];

  beforeAll(async () => {
    process.env["KINTSUGI_SECRET_KEY"] ??= randomBytes(32).toString("base64");
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    await remote.createRepository("legacy-app");
    dataDir = await mkdtemp(join(tmpdir(), "kintsugi-worker-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
    deps = { store: new RepositoryStore(db.pool), storage };
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('internal', 'plain-git', 'Internal', $1, 'none')", [
      remote.baseUrl,
    ]);
  });
  afterAll(async () => {
    await remote?.close();
    await db?.drop();
    if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  });

  it("clones a new repository into a mirror, then fetches new commits", async () => {
    await repository("legacy-app", `${remote.baseUrl}/legacy-app.git`);
    const first = await syncRepository(deps, "legacy-app");
    expect(first).toMatchObject({ repositoryId: "legacy-app", cloned: true });
    expect(existsSync(storage.mirror("internal", "legacy-app"))).toBe(true);
    expect(await row("legacy-app")).toMatchObject({ sync_status: "ready", last_commit: first!.commit, last_error: null });

    const next = await remote.commit("legacy-app", "CHANGELOG.md", "v2\n");
    const second = await syncRepository(deps, "legacy-app");
    expect(second).toMatchObject({ cloned: false, commit: next });
    expect((await row("legacy-app"))?.last_commit).toBe(next);
  });

  it("records a failed sync on the repository and leaves no half-cloned mirror", async () => {
    await repository("missing", `${remote.baseUrl}/missing.git`);
    await expect(syncRepository(deps, "missing")).rejects.toThrow();
    const failed = await row("missing");
    expect(failed?.sync_status).toBe("error");
    expect(failed?.last_error).toMatch(/git clone/);
    expect(existsSync(storage.mirror("internal", "missing"))).toBe(false);
  });

  it("decrypts the server's token for the call and never stores it in the mirror", async () => {
    const token = "TEST-worker-token-0123456789";
    await db.pool.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('tls', 'gitea', 'TLS', 'https://127.0.0.1:9', 'token')");
    const secret = encryptSecret(token);
    await db.pool.query("insert into admin.git_secret (secret_id, server_id, ciphertext, iv, auth_tag) values ('git-server:tls:token', 'tls', $1, $2, $3)", [
      secret.ciphertext,
      secret.iv,
      secret.authTag,
    ]);
    await repository("over-tls", "https://127.0.0.1:9/org/repo.git", "tls");
    const target = await deps.store.target("over-tls");
    expect(target?.credential).toEqual({ kind: "token", token });

    await expect(syncRepository(deps, "over-tls")).rejects.toThrow();
    expect((await row("over-tls"))?.last_error).not.toContain(token);
  });

  it("prunes mirrors of removed repositories", async () => {
    await db.pool.query("delete from admin.git_repository where id = 'legacy-app'");
    expect(await pruneMirrors(deps)).toEqual(["internal/legacy-app"]);
    expect(existsSync(storage.mirror("internal", "legacy-app"))).toBe(false);
  });

  it("the worker picks up a newly registered repository from the queue", async () => {
    await remote.createRepository("billing");
    const worker = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, pendingScanSeconds: 1, log: () => undefined });
    try {
      await repository("billing", `${remote.baseUrl}/billing.git`);
      await expect.poll(async () => (await row("billing"))?.sync_status, { timeout: 30_000, interval: 250 }).toBe("ready");
    } finally {
      await worker.stop();
    }
    // A restarted worker reuses the existing queue.
    const restarted = await startWorker({ databaseUrl: db.url, pool: db.pool, storage, pollIntervalSeconds: 3600, log: () => undefined });
    await restarted.stop();
  });
});
