import { encryptSecret } from "@kintsugi/secrets";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { RepositoryStore } from "../src/git-sync/repositories.js";

describe("GitHub provider connection binding", () => {
  it("reads the App key by its exact secret id and never mistakes it for the clone token", async () => {
    const priorKey = process.env["KINTSUGI_SECRET_KEY"];
    process.env["KINTSUGI_SECRET_KEY"] = Buffer.alloc(32, 7).toString("base64");
    const cloneToken = encryptSecret("TEST-clone-token");
    const appKey = encryptSecret("TEST-github-app-private-key");
    const appSecretId = "git-server:ghes-connected:github-app-private-key";
    const tokenSecretId = "git-server:ghes-connected:token";
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("from admin.git_repository r join admin.git_server s")) {
          return { rows: [{
            id: "billing",
            server_id: "ghes-connected",
            url: "https://ghe.example.invalid/Acme/Billing.git",
            default_branch: "main",
            auth_type: "token",
            username: null,
            known_hosts: null,
            kind: "github-enterprise",
            base_url: "https://ghe.example.invalid",
            github_app_id: "12345",
            github_installation_id: "67890",
          }] };
        }
        if (sql.includes("from admin.git_secret where secret_id = $1")) {
          const secret = values?.[0] === appSecretId ? appKey : values?.[0] === tokenSecretId ? cloneToken : undefined;
          return { rows: secret === undefined ? [] : [{ ciphertext: secret.ciphertext, iv: secret.iv, auth_tag: secret.authTag }] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;
    try {
      const store = new RepositoryStore(pool);
      const clone = await store.target("billing");
      const provider = await store.githubProviderConnection("billing");

      expect(clone?.credential).toEqual({ kind: "token", token: "TEST-clone-token" });
      expect(provider).toMatchObject({ appId: "12345", installationId: "67890", privateKey: "TEST-github-app-private-key", repositoryPath: "Acme/Billing" });
      expect(calls.some((call) => call.values?.[0] === appSecretId)).toBe(true);
      expect(calls.some((call) => call.values?.[0] === tokenSecretId)).toBe(true);
      expect(JSON.stringify(clone)).not.toContain("TEST-github-app-private-key");
    } finally {
      if (priorKey === undefined) delete process.env["KINTSUGI_SECRET_KEY"];
      else process.env["KINTSUGI_SECRET_KEY"] = priorKey;
    }
  });

  it("uses an existing server token only as an unverified GitHub observation credential", async () => {
    const priorKey = process.env["KINTSUGI_SECRET_KEY"];
    process.env["KINTSUGI_SECRET_KEY"] = Buffer.alloc(32, 8).toString("base64");
    const encrypted = encryptSecret("TEST-legacy-github-token");
    const tokenSecretId = "git-server:github-server:token";
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("from admin.git_repository r join admin.git_server s")) {
          return { rows: [{
            id: "public-repo",
            server_id: "github-server",
            url: "git@github.com:Acme/Billing.git",
            default_branch: "main",
            auth_type: "token",
            username: null,
            known_hosts: null,
            kind: "github",
            base_url: "https://github.com",
            github_app_id: null,
            github_installation_id: null,
          }] };
        }
        if (sql.includes("from admin.git_secret where secret_id = $1") && values?.[0] === tokenSecretId) {
          return { rows: [{ ciphertext: encrypted.ciphertext, iv: encrypted.iv, auth_tag: encrypted.authTag }] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;
    try {
      const provider = await new RepositoryStore(pool).githubProviderConnection("public-repo");
      expect(provider).toEqual({ kind: "github", baseUrl: "https://github.com", token: "TEST-legacy-github-token", repositoryPath: "Acme/Billing" });
    } finally {
      if (priorKey === undefined) delete process.env["KINTSUGI_SECRET_KEY"];
      else process.env["KINTSUGI_SECRET_KEY"] = priorKey;
    }
  });
});
