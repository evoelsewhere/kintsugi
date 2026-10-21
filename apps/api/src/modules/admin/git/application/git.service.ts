// Application layer: use cases of Git servers and repositories (Settings → Git).
// Depends on the domain ports only; knows nothing about HTTP, Postgres or the git CLI.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createPrivateKey } from "node:crypto";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import {
  type GitRepositoryRecord,
  type GitServerRecord,
  type RegisterGitRepository,
  type RegisterGitServer,
  remoteLocation,
  RepositoryInUseError,
  repositoryUrlProblem,
} from "../domain/git.js";
import { GitRegistry, GitRemote } from "../domain/git.ports.js";

export interface TestAccessResult {
  ok: boolean;
  message: string;
  defaultBranch?: string;
  branchCount?: number;
}

const hasCredential = (input: RegisterGitServer): boolean => input.credential.token !== undefined || input.credential.privateKey !== undefined;

/** The credential an auth type needs, or a reason it is incomplete. */
function credentialProblem(input: RegisterGitServer): string | undefined {
  if (input.authType === "token" && input.credential.token === undefined) return "A token server needs a token.";
  if (input.authType === "ssh-key") {
    if (input.credential.privateKey === undefined) return "An SSH server needs a private key.";
    if ((input.knownHosts ?? "").trim() === "") return "An SSH server needs its pinned host keys (known_hosts lines).";
  }
  return undefined;
}

/** A URL for the audit log: HTTP(S) user info (where a token could hide) is dropped. */
function auditUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || (parsed.username === "" && parsed.password === "")) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The names of the server settings a replacement changes; `credential` when a new one is entered (never its value). */
function changedServerFields(existing: GitServerRecord, input: RegisterGitServer): string[] {
  const keys = ["kind", "name", "baseUrl", "authType", "username", "knownHosts"] as const;
  const fields: string[] = keys.filter((key) => (existing[key] ?? "") !== (input[key] ?? ""));
  if (hasCredential(input)) fields.push("credential");
  if (
    input.githubApp !== undefined &&
    (input.githubApp === null ||
      existing.githubApp?.appId !== input.githubApp.appId ||
      existing.githubApp?.installationId !== input.githubApp.installationId ||
      input.githubApp.privateKey !== undefined)
  ) fields.push("githubApp");
  if (input.githubWebhookSecret !== undefined) fields.push("githubWebhookSecret");
  return fields.sort();
}

function githubAppHostProblem(input: Pick<RegisterGitServer, "kind" | "baseUrl">): string | undefined {
  if (input.kind !== "github" && input.kind !== "github-enterprise") return "GitHub App credentials can only be configured for GitHub.com or GitHub Enterprise.";
  let base: URL;
  try {
    base = new URL(input.baseUrl);
  } catch {
    return "GitHub App credentials require a valid GitHub host URL.";
  }
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.pathname !== "/" && base.pathname !== "") ||
    (input.kind === "github" && base.hostname.toLowerCase() !== "github.com") ||
    (input.kind === "github-enterprise" && base.hostname.toLowerCase() === "github.com")
  ) return "GitHub App credentials must match the registered GitHub HTTPS host.";
  return undefined;
}

function githubAppProblem(input: RegisterGitServer): string | undefined {
  const app = input.githubApp;
  if (app === undefined || app === null) return undefined;
  const hostProblem = githubAppHostProblem(input);
  if (hostProblem !== undefined) return hostProblem;
  if (!/^\d+$/.test(app.appId) || !/^\d+$/.test(app.installationId)) return "GitHub App and installation IDs must be numeric.";
  try {
    const key = createPrivateKey(app.privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      return "GitHub App private keys must use RSA with at least 2048 bits.";
    }
  } catch {
    return "GitHub App private key must be a valid RSA private key.";
  }
  return undefined;
}

function githubWebhookSecretProblem(input: RegisterGitServer): string | undefined {
  if (input.githubWebhookSecret === undefined || input.githubWebhookSecret === null) return undefined;
  if (input.githubWebhookSecret.trim().length < 32 || input.githubWebhookSecret.length > 8192) {
    return "GitHub webhook secrets must contain at least 32 non-whitespace characters and no more than 8192 characters.";
  }
  if (input.kind !== "github" && input.kind !== "github-enterprise") {
    return "GitHub webhook secrets can only be configured for GitHub.com or GitHub Enterprise.";
  }
  const hostProblem = githubAppHostProblem(input);
  return hostProblem?.replace("GitHub App credentials", "GitHub webhook secrets");
}

@Injectable()
export class GitService {
  constructor(
    private readonly registry: GitRegistry,
    private readonly remote: GitRemote,
    private readonly audit: AuditTrail,
  ) {}

  // ---- servers ----

  async listServers(query: PageQuery): Promise<Page<GitServerRecord>> {
    const servers = await this.registry.listServers();
    return toPage(servers.slice(query.offset, query.offset + query.limit), servers.length, query);
  }

  getServer(id: string): Promise<GitServerRecord> {
    return this.#mustGetServer(id);
  }

  async createServer(input: RegisterGitServer, actor: Actor): Promise<GitServerRecord> {
    if ((await this.registry.getServer(input.id)) !== undefined) throw new ConflictException(`Git server ${input.id} already exists`);
    const problem = credentialProblem(input);
    if (problem !== undefined) throw new BadRequestException(problem);
    const appProblem = githubAppProblem(input);
    if (appProblem !== undefined) throw new BadRequestException(appProblem);
    const webhookProblem = githubWebhookSecretProblem(input);
    if (webhookProblem !== undefined) throw new BadRequestException(webhookProblem);
    const server = await this.registry.createServer(input);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitServerCreate, {
        subject: server.id,
        detail: {
          kind: server.kind,
          name: server.name,
          baseUrl: auditUrl(server.baseUrl),
          authType: server.authType,
          githubAppConfigured: input.githubApp != null,
          githubWebhookSecretConfigured: input.githubWebhookSecret != null,
        },
      }),
    );
    return server;
  }

  async replaceServer(id: string, input: RegisterGitServer, actor: Actor): Promise<GitServerRecord> {
    const existing = await this.#mustGetServer(id);
    const appProblem = githubAppProblem(input);
    if (appProblem !== undefined) throw new BadRequestException(appProblem);
    const webhookProblem = githubWebhookSecretProblem(input);
    if (webhookProblem !== undefined) throw new BadRequestException(webhookProblem);
    const githubKind = input.kind === "github" || input.kind === "github-enterprise";
    if (existing.hasGithubWebhookSecret && input.githubWebhookSecret === undefined) {
      if (!githubKind) {
        throw new BadRequestException("Remove the GitHub webhook secret explicitly before changing this server to another provider.");
      }
      const existingOrigin = new URL(existing.baseUrl).origin;
      const replacementOrigin = new URL(input.baseUrl).origin;
      if (existingOrigin !== replacementOrigin) {
        throw new BadRequestException("Changing the GitHub host requires re-entering its webhook secret or explicitly removing it.");
      }
    }
    if (existing.githubApp !== undefined && !githubKind && input.githubApp === undefined) {
      throw new BadRequestException("Remove the GitHub App configuration explicitly before changing this server to another provider.");
    }
    if (existing.githubApp !== undefined && input.githubApp === undefined) {
      const appHostProblem = githubAppHostProblem(input);
      if (appHostProblem !== undefined) throw new BadRequestException(appHostProblem);
      const existingOrigin = new URL(existing.baseUrl).origin;
      const replacementOrigin = new URL(input.baseUrl).origin;
      if (existingOrigin !== replacementOrigin) {
        throw new BadRequestException("Changing the GitHub API origin requires re-entering its App configuration.");
      }
    }
    const fresh = hasCredential(input);
    if (fresh) {
      const problem = credentialProblem(input);
      if (problem !== undefined) throw new BadRequestException(problem);
    } else {
      // A kept credential stays bound to its server: same auth type, same host.
      if (input.authType !== existing.authType && input.authType !== "none") {
        throw new BadRequestException("Changing the authentication type requires entering the new credential");
      }
      if (input.authType === "ssh-key" && (input.knownHosts ?? "").trim() === "") {
        throw new BadRequestException("An SSH server needs its pinned host keys (known_hosts lines).");
      }
    }
    const hostChanged = remoteLocation(existing.baseUrl)?.host !== remoteLocation(input.baseUrl)?.host;
    if (hostChanged && !fresh && input.authType !== "none") {
      throw new BadRequestException("Changing the server host requires re-entering its credential");
    }
    // Registered repositories must keep satisfying the host rule.
    for (const repository of await this.registry.listRepositories()) {
      if (repository.serverId !== id) continue;
      const problem = repositoryUrlProblem(repository.url, input);
      if (problem !== undefined) throw new ConflictException(`Repository ${repository.id} would no longer match this server: ${problem}`);
    }
    const updated = await this.registry.replaceServer(id, input);
    if (updated === undefined) throw new NotFoundException(`Git server ${id} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitServerUpdate, { subject: id, detail: { name: updated.name, fields: changedServerFields(existing, input) } }),
    );
    return updated;
  }

  async removeServer(id: string, actor: Actor): Promise<void> {
    const server = await this.#mustGetServer(id);
    const repositories = await this.registry.countRepositories(id);
    if (repositories > 0) throw new ConflictException(`Git server ${id} still has ${repositories} repositories; remove them first`);
    await this.registry.removeServer(id);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.gitServerDelete, { subject: id, detail: { kind: server.kind, name: server.name } }));
  }

  /** "Test access": lists a repository's branches with the server's stored credential. */
  async testAccess(serverId: string, url: string): Promise<TestAccessResult> {
    const server = await this.#mustGetServer(serverId);
    const problem = repositoryUrlProblem(url, server);
    if (problem !== undefined) return { ok: false, message: problem };
    try {
      const probe = await this.remote.probe(url, (await this.registry.serverAccess(serverId))!);
      return {
        ok: true,
        message: `Reachable: ${probe.branchCount} branch${probe.branchCount === 1 ? "" : "es"}${probe.defaultBranch === undefined ? "" : `, default ${probe.defaultBranch}`}`,
        ...probe,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  // ---- repositories ----

  async listRepositories(query: PageQuery): Promise<Page<GitRepositoryRecord>> {
    const repositories = await this.registry.listRepositories();
    return toPage(repositories.slice(query.offset, query.offset + query.limit), repositories.length, query);
  }

  async getRepository(id: string): Promise<GitRepositoryRecord> {
    const repository = await this.registry.getRepository(id);
    if (repository === undefined) throw new NotFoundException(`Repository ${id} not found`);
    return repository;
  }

  /**
   * Registers a repository after checking it is reachable with the server's credential.
   * The clone itself is the worker's job (ADR-0025): the repository starts `pending`.
   */
  async createRepository(input: Omit<RegisterGitRepository, "defaultBranch">, actor: Actor): Promise<GitRepositoryRecord> {
    if ((await this.registry.getRepository(input.id)) !== undefined) throw new ConflictException(`Repository ${input.id} already exists`);
    if ((await this.registry.findRepositoryByUrl(input.url)) !== undefined) throw new ConflictException(`${input.url} is already registered`);
    const access = await this.testAccess(input.serverId, input.url);
    if (!access.ok) throw new BadRequestException(`Cannot reach ${input.url}: ${access.message}`);
    const repository = await this.registry.createRepository({ ...input, ...(access.defaultBranch === undefined ? {} : { defaultBranch: access.defaultBranch }) });
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitRepositoryCreate, { subject: repository.id, detail: { serverId: repository.serverId, url: auditUrl(repository.url) } }),
    );
    return repository;
  }

  async removeRepository(id: string, actor: Actor): Promise<void> {
    const existing = await this.registry.getRepository(id);
    let removed: boolean;
    try {
      removed = await this.registry.removeRepository(id);
    } catch (error) {
      if (error instanceof RepositoryInUseError) throw new ConflictException(error.message);
      throw error;
    }
    if (!removed) throw new NotFoundException(`Repository ${id} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitRepositoryDelete, {
        subject: id,
        ...(existing === undefined ? {} : { detail: { serverId: existing.serverId, url: auditUrl(existing.url) } }),
      }),
    );
  }

  async #mustGetServer(id: string): Promise<GitServerRecord> {
    const server = await this.registry.getServer(id);
    if (server === undefined) throw new NotFoundException(`Git server ${id} not found`);
    return server;
  }
}
