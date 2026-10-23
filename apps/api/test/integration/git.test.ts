// Git servers and repositories (ADR-0025): permission gate, write-only encrypted
// credentials, the host binding of credentials, and registration over a real git remote.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { hasDatabase } from "../support/database.js";
import { type Client, adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { type GitHttpServer, startGitHttpServer } from "@kintsugi/git/testing";

const TOKEN = "glpat-TEST-secret-token-0123456789";
const GITHUB_WEBHOOK_SECRET = "TEST-github-webhook-secret-0123456789";
const SSH_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST-secret-key-material\n-----END OPENSSH PRIVATE KEY-----";
const GITHUB_APP_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe.skipIf(!hasDatabase)("git servers and repositories (integration)", () => {
  let app: TestApp;
  let admin: Client;
  let remote: GitHttpServer;
  const bodies: string[] = [];

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await admin.request(method, path, body === undefined ? {} : { body });
    bodies.push(response.raw);
    return response;
  };

  beforeAll(async () => {
    app = await startTestApp();
    admin = await adminClient(app);
    remote = await startGitHttpServer();
    await remote.createRepository("legacy-app", "trunk");
  });
  afterAll(async () => {
    await remote?.close();
    await app?.close();
  });

  it("every route requires git.manage", async () => {
    const { client } = await memberClient(app, admin, "no-git", ["user"]);
    for (const [method, path] of [
      ["GET", "/admin/git-servers"],
      ["POST", "/admin/git-servers"],
      ["GET", "/admin/git-servers/any"],
      ["PATCH", "/admin/git-servers/any"],
      ["DELETE", "/admin/git-servers/any"],
      ["POST", "/admin/git-servers/any/test"],
      ["GET", "/admin/git-repositories"],
      ["POST", "/admin/git-repositories"],
      ["GET", "/admin/git-repositories/any/branches"],
      ["PATCH", "/admin/git-repositories/any"],
      ["DELETE", "/admin/git-repositories/any"],
    ] as const) {
      const response = await client.request(method, path, method === "GET" || method === "DELETE" ? {} : { body: {} });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("stores credentials encrypted and never returns them", async () => {
    const created = await call("POST", "/admin/git-servers", {
      id: "gitlab",
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.example.invalid",
      authType: "token",
      token: TOKEN,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "gitlab", authType: "token", hasCredential: true });

    const ssh = await call("POST", "/admin/git-servers", {
      id: "ssh-server",
      kind: "plain-git",
      name: "SSH",
      baseUrl: "https://git.example.invalid",
      authType: "ssh-key",
      privateKey: SSH_KEY,
      knownHosts: "git.example.invalid ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey",
    });
    expect(ssh.status).toBe(201);
    await call("GET", "/admin/git-servers");
    await call("GET", "/admin/git-servers/ssh-server");

    const stored = await app.db.query<{ ciphertext: string }>("select ciphertext from admin.git_secret");
    expect(stored.rows).toHaveLength(2);
    expect(JSON.stringify(stored.rows)).not.toContain(TOKEN);
    expect(JSON.stringify(stored.rows)).not.toContain("TEST-secret-key-material");
  });

  it("stores GitHub App configuration separately and exposes only write-only status", async () => {
    const created = await call("POST", "/admin/git-servers", {
      id: "ghes-app",
      kind: "github-enterprise",
      name: "Enterprise GitHub",
      baseUrl: "https://ghe.example.invalid",
      authType: "none",
      githubApp: { appId: "12345", installationId: "67890", privateKey: GITHUB_APP_KEY },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: "ghes-app",
      hasCredential: false,
      githubApp: { appId: "12345", installationId: "67890", hasPrivateKey: true },
    });
    expect(JSON.stringify(created.body)).not.toContain(GITHUB_APP_KEY);

    const secrets = await app.db.query<{ secret_id: string; ciphertext: string }>("select secret_id, ciphertext from admin.git_secret where server_id = 'ghes-app'");
    expect(secrets.rows).toHaveLength(1);
    expect(secrets.rows[0]?.secret_id).toBe("git-server:ghes-app:github-app-private-key");
    expect(JSON.stringify(secrets.rows)).not.toContain(GITHUB_APP_KEY);
    const fetched = await call("GET", "/admin/git-servers/ghes-app");
    expect(fetched.body.data).toMatchObject({ githubApp: { hasPrivateKey: true } });
    expect(JSON.stringify(fetched.body)).not.toContain(GITHUB_APP_KEY);
  });

  it("stores the GitHub webhook secret encrypted, preserves omission and removes it only when requested", async () => {
    const weak = await call("POST", "/admin/git-servers", {
      id: "github-hook-weak",
      kind: "github",
      name: "Weak webhook config",
      baseUrl: "https://github.com",
      authType: "none",
      githubWebhookSecret: "too-short",
    });
    expect(weak.status).toBe(400);

    const created = await call("POST", "/admin/git-servers", {
      id: "github-hook-config",
      kind: "github",
      name: "GitHub webhook config",
      baseUrl: "https://github.com",
      authType: "none",
      githubWebhookSecret: GITHUB_WEBHOOK_SECRET,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "github-hook-config", hasGithubWebhookSecret: true });
    expect(JSON.stringify(created.body)).not.toContain(GITHUB_WEBHOOK_SECRET);

    const stored = await app.db.query<{ ciphertext: string; secret_id: string }>(
      "select secret_id, ciphertext from admin.git_secret where server_id = 'github-hook-config'",
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.secret_id).toBe("git-server:github-hook-config:github-webhook-secret");
    expect(stored.rows[0]?.ciphertext).not.toContain(GITHUB_WEBHOOK_SECRET);

    const omitted = await call("PATCH", "/admin/git-servers/github-hook-config", {
      kind: "github",
      name: "GitHub webhook config",
      baseUrl: "https://github.com",
      authType: "none",
    });
    expect(omitted.status).toBe(200);
    expect(omitted.body.data).toMatchObject({ hasGithubWebhookSecret: true });

    const removed = await call("PATCH", "/admin/git-servers/github-hook-config", {
      kind: "github",
      name: "GitHub webhook config",
      baseUrl: "https://github.com",
      authType: "none",
      githubWebhookSecret: null,
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ hasGithubWebhookSecret: false });
    expect((await app.db.query("select secret_id from admin.git_secret where server_id = 'github-hook-config'")).rows).toHaveLength(0);
  });

  it("rejects provider observations that pair a repository with another Git server", async () => {
    await expect(app.db.query(
      `insert into admin.git_server (id, kind, name, base_url, auth_type, github_app_id)
       values ('provider-partial-app', 'github', 'Partial App', 'https://github.com', 'none', '12345')`,
    )).rejects.toMatchObject({ code: "23514" });

    for (const id of ["provider-a", "provider-b"]) {
      const created = await call("POST", "/admin/git-servers", {
        id,
        kind: "github",
        name: id,
        baseUrl: "https://github.com",
        authType: "none",
      });
      expect(created.status).toBe(201);
    }
    await app.db.query(
      "insert into admin.git_repository (id, server_id, url) values ('provider-repo', 'provider-a', 'https://github.com/Acme/Provider-repo.git')",
    );

    await expect(app.db.query(
      "insert into workflow.member_provider_sync_watermark (server_id, repository_id) values ('provider-b', 'provider-repo')",
    )).rejects.toMatchObject({ code: "23503" });
    await app.db.query(
      "insert into workflow.member_provider_sync_watermark (server_id, repository_id) values ('provider-a', 'provider-repo')",
    );

    await app.db.query("delete from admin.git_repository where id = 'provider-repo'");
    for (const id of ["provider-a", "provider-b"]) await app.db.query("delete from admin.git_server where id = $1", [id]);
  });

  it("rejects GitHub App credentials for other providers and requires re-binding on host changes", async () => {
    const wrongProvider = await call("POST", "/admin/git-servers", {
      id: "gitlab-app",
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.example.invalid",
      authType: "none",
      githubApp: { appId: "12345", installationId: "67890", privateKey: GITHUB_APP_KEY },
    });
    expect(wrongProvider.status).toBe(400);

    const unchanged = await call("PATCH", "/admin/git-servers/ghes-app", {
      kind: "github-enterprise",
      name: "Enterprise GitHub",
      baseUrl: "https://other-ghe.example.invalid",
      authType: "none",
    });
    expect(unchanged.status).toBe(400);

    const rebound = await call("PATCH", "/admin/git-servers/ghes-app", {
      kind: "github-enterprise",
      name: "Enterprise GitHub",
      baseUrl: "https://other-ghe.example.invalid",
      authType: "none",
      githubApp: { appId: "12345", installationId: "67890", privateKey: GITHUB_APP_KEY },
    });
    expect(rebound.status).toBe(200);
    expect(rebound.body.data).toMatchObject({ githubApp: { appId: "12345", hasPrivateKey: true } });
  });

  it("rotates clone credentials without deleting the App key and can remove the App independently", async () => {
    const created = await call("POST", "/admin/git-servers", {
      id: "ghes-secret-rotation",
      kind: "github-enterprise",
      name: "GHES rotation",
      baseUrl: "https://rotation-ghe.example.invalid",
      authType: "none",
      githubApp: { appId: "12345", installationId: "67890", privateKey: GITHUB_APP_KEY },
    });
    expect(created.status).toBe(201);

    const withToken = await call("PATCH", "/admin/git-servers/ghes-secret-rotation", {
      kind: "github-enterprise",
      name: "GHES rotation",
      baseUrl: "https://rotation-ghe.example.invalid",
      authType: "token",
      token: TOKEN,
    });
    expect(withToken.status).toBe(200);
    expect(withToken.body.data).toMatchObject({ hasCredential: true, githubApp: { hasPrivateKey: true } });
    const bothSecrets = await app.db.query<{ secret_id: string }>("select secret_id from admin.git_secret where server_id = 'ghes-secret-rotation' order by secret_id");
    expect(bothSecrets.rows.map((row) => row.secret_id)).toEqual([
      "git-server:ghes-secret-rotation:github-app-private-key",
      "git-server:ghes-secret-rotation:token",
    ]);

    const withoutApp = await call("PATCH", "/admin/git-servers/ghes-secret-rotation", {
      kind: "github-enterprise",
      name: "GHES rotation",
      baseUrl: "https://rotation-ghe.example.invalid",
      authType: "token",
      githubApp: null,
    });
    expect(withoutApp.status).toBe(200);
    expect(withoutApp.body.data).toMatchObject({ hasCredential: true });
    expect(withoutApp.body.data).not.toHaveProperty("githubApp");
    const remainingSecrets = await app.db.query<{ secret_id: string }>("select secret_id from admin.git_secret where server_id = 'ghes-secret-rotation'");
    expect(remainingSecrets.rows.map((row) => row.secret_id)).toEqual(["git-server:ghes-secret-rotation:token"]);
  });

  it("requires the credential its auth type needs", async () => {
    const base = { kind: "github", name: "GitHub", baseUrl: "https://github.example.invalid" };
    expect((await call("POST", "/admin/git-servers", { ...base, id: "no-token", authType: "token" })).status).toBe(400);
    expect((await call("POST", "/admin/git-servers", { ...base, id: "no-hosts", authType: "ssh-key", privateKey: SSH_KEY })).status).toBe(400);
    expect((await call("POST", "/admin/git-servers", { ...base, id: "bad-url", authType: "none", baseUrl: "ftp://x" })).status).toBe(400);
  });

  it("keeps a stored token bound to its host", async () => {
    const replace = { kind: "gitlab", name: "GitLab", authType: "token" };
    const moved = await call("PATCH", "/admin/git-servers/gitlab", { ...replace, baseUrl: "https://elsewhere.example.invalid" });
    expect(moved.status).toBe(400);
    const renamed = await call("PATCH", "/admin/git-servers/gitlab", { ...replace, name: "GitLab EE", baseUrl: "https://gitlab.example.invalid/" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: "GitLab EE", hasCredential: true });
  });

  it("only tests repositories on the server's own host", async () => {
    const elsewhere = await call("POST", "/admin/git-servers/gitlab/test", { url: "https://evil.example.invalid/org/repo.git" });
    expect(elsewhere.body.data).toMatchObject({ ok: false });
    expect((elsewhere.body.data as { message: string }).message).toMatch(/does not match/);

    const overHttp = await call("POST", "/admin/git-servers/gitlab/test", { url: "http://gitlab.example.invalid/org/repo.git" });
    expect(overHttp.body.data).toMatchObject({ ok: false, message: "Tokens are only sent over HTTPS." });

    const sshUnpinned = await call("POST", "/admin/git-servers/ssh-server/test", { url: "git@other.example.invalid:org/repo.git" });
    expect((sshUnpinned.body.data as { message: string }).message).toMatch(/No SSH host key is pinned/);
  });

  it("reports an unreachable remote without leaking the token", async () => {
    await call("POST", "/admin/git-servers", {
      id: "local-tls",
      kind: "gitea",
      name: "Local",
      baseUrl: "https://127.0.0.1:9",
      authType: "token",
      token: TOKEN,
    });
    const result = await call("POST", "/admin/git-servers/local-tls/test", { url: "https://127.0.0.1:9/org/repo.git" });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ ok: false });
  });

  it("registers a reachable repository with its default branch, pending its first clone", async () => {
    const server = await call("POST", "/admin/git-servers", {
      id: "internal",
      kind: "plain-git",
      name: "Internal",
      baseUrl: remote.baseUrl,
      authType: "none",
    });
    expect(server.status).toBe(201);

    const url = `${remote.baseUrl}/legacy-app.git`;
    const tested = await call("POST", "/admin/git-servers/internal/test", { url });
    expect(tested.body.data).toMatchObject({ ok: true, defaultBranch: "trunk", branchCount: 1 });

    const created = await call("POST", "/admin/git-repositories", { id: "legacy-app", serverId: "internal", url });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "legacy-app", serverId: "internal", url, defaultBranch: "trunk", syncStatus: "pending" });

    expect((await call("POST", "/admin/git-repositories", { id: "again", serverId: "internal", url })).status).toBe(409);
    const missing = await call("POST", "/admin/git-repositories", { id: "missing", serverId: "internal", url: `${remote.baseUrl}/missing.git` });
    expect(missing.status).toBe(400);

    // The branch Kintsugi follows can be moved to another branch of the server; the worker then syncs it again.
    await remote.commit("legacy-app", "RELEASE.md", "release\n", "release");
    const branches = await call("GET", "/admin/git-repositories/legacy-app/branches");
    expect(branches.body.data).toEqual({ branches: ["release", "trunk"], remoteDefault: "trunk", current: "trunk" });
    expect((await call("PATCH", "/admin/git-repositories/legacy-app", { defaultBranch: "nope" })).status).toBe(400);
    expect((await call("PATCH", "/admin/git-repositories/legacy-app", { defaultBranch: "bad branch" })).status).toBe(400);
    await app.db.query("update admin.git_repository set sync_status = 'ready' where id = 'legacy-app'");
    const moved = await call("PATCH", "/admin/git-repositories/legacy-app", { defaultBranch: "release" });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ id: "legacy-app", defaultBranch: "release", syncStatus: "pending" });
    expect((await call("PATCH", "/admin/git-repositories/missing", { defaultBranch: "release" })).status).toBe(404);

    // A server with repositories cannot be removed or moved away from them.
    expect((await call("DELETE", "/admin/git-servers/internal")).status).toBe(409);
    const rehosted = await call("PATCH", "/admin/git-servers/internal", { kind: "plain-git", name: "Internal", baseUrl: "https://moved.example.invalid", authType: "none" });
    expect(rehosted.status).toBe(409);

    expect((await call("DELETE", "/admin/git-repositories/legacy-app")).status).toBe(204);
    expect((await call("DELETE", "/admin/git-servers/internal")).status).toBe(204);
  });

  it("removing a server removes its stored credential", async () => {
    expect((await call("DELETE", "/admin/git-servers/ssh-server")).status).toBe(204);
    const left = await app.db.query("select 1 from admin.git_secret where server_id = 'ssh-server'");
    expect(left.rowCount).toBe(0);
  });

  it("no response in this suite contained a credential", () => {
    expect(bodies.length).toBeGreaterThan(10);
    for (const raw of bodies) {
      expect(raw).not.toContain(TOKEN);
      expect(raw).not.toContain("TEST-secret-key-material");
    }
  });
});
