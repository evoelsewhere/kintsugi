import { BadRequestException } from "@nestjs/common";
import { generateKeyPairSync } from "node:crypto";
import type { Actor } from "../../src/common/auth/decorators.js";
import { GitService } from "../../src/modules/admin/git/application/git.service.js";
import type { GitRegistry, GitRemote } from "../../src/modules/admin/git/domain/git.ports.js";
import type { GitServerRecord, RegisterGitServer } from "../../src/modules/admin/git/domain/git.js";
import { describe, expect, it, vi } from "vitest";

const record: GitServerRecord = {
  id: "ghes",
  kind: "github-enterprise",
  name: "GHES",
  baseUrl: "https://ghe.example.invalid",
  authType: "none",
  hasCredential: false,
  githubApp: { appId: "12345", installationId: "67890", hasPrivateKey: true },
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};

function service(existing?: GitServerRecord) {
  const registry = {
    getServer: vi.fn(async () => existing),
    createServer: vi.fn(async () => record),
    listRepositories: vi.fn(async () => []),
    replaceServer: vi.fn(async () => record),
  } as unknown as GitRegistry;
  const audit = { recordChange: vi.fn(async () => undefined) };
  return { service: new GitService(registry, {} as GitRemote, audit as never), registry };
}

describe("GitHub App admin configuration", () => {
  it("rejects App credentials on non-GitHub servers before persistence", async () => {
    const { service: git, registry } = service();
    const input = {
      id: "gitlab-app",
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.example.invalid",
      authType: "none",
      credential: {},
      githubApp: { appId: "12345", installationId: "67890", privateKey: "TEST-private-key" },
    } as unknown as RegisterGitServer;

    await expect(git.createServer(input, {} as Actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.createServer).not.toHaveBeenCalled();
  });

  it("requires GitHub App credentials to be rebound when the registered host changes", async () => {
    const { service: git, registry } = service(record);
    const input = {
      id: "ghes",
      kind: "github-enterprise",
      name: "GHES",
      baseUrl: "https://other-ghe.example.invalid",
      authType: "none",
      credential: {},
    } as RegisterGitServer;

    await expect(git.replaceServer("ghes", input, {} as Actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.replaceServer).not.toHaveBeenCalled();
  });

  it.each([
    ["downgrade to HTTP", "http://ghe.example.invalid"],
    ["add an API path", "https://ghe.example.invalid/enterprise"],
    ["change the origin port", "https://ghe.example.invalid:8443"],
  ])("requires App re-binding when %s", async (_label, baseUrl) => {
    const { service: git, registry } = service(record);
    const input = {
      id: "ghes",
      kind: "github-enterprise",
      name: "GHES",
      baseUrl,
      authType: "none",
      credential: {},
    } as RegisterGitServer;

    await expect(git.replaceServer("ghes", input, {} as Actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.replaceServer).not.toHaveBeenCalled();
  });

  it("rejects RSA keys below 2048 bits before persistence", async () => {
    const { service: git, registry } = service();
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const input = {
      id: "github-app",
      kind: "github",
      name: "GitHub",
      baseUrl: "https://github.com",
      authType: "none",
      credential: {},
      githubApp: { appId: "12345", installationId: "67890", privateKey },
    } as RegisterGitServer;

    await expect(git.createServer(input, {} as Actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(registry.createServer).not.toHaveBeenCalled();
  });
});
