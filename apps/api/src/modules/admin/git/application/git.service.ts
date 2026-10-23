// Application layer: use cases of Git servers and repositories (Settings → Git).
// Depends on the domain ports only; knows nothing about HTTP, Postgres or the git CLI.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page, PageQuery } from "#common/application/pagination.js";
import { toPage } from "#common/application/pagination.js";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import {
  type GitRepositoryRecord,
  type GitServerRecord,
  type RegisterGitRepository,
  type RegisterGitServer,
  type RemoteProbe,
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

export interface RepositoryBranches {
  branches: string[];
  /** The branch the server's HEAD points to. */
  remoteDefault?: string;
  /** The branch Kintsugi follows now. */
  current?: string;
}

const hasCredential =(input: RegisterGitServer): boolean => input.credential.token !== undefined || input.credential.privateKey !== undefined;

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
  return fields.sort();
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
    const server = await this.registry.createServer(input);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitServerCreate, {
        subject: server.id,
        detail: {
          kind: server.kind,
          name: server.name,
          baseUrl: auditUrl(server.baseUrl),
          authType: server.authType,
        },
      }),
    );
    return server;
  }

  async replaceServer(id: string, input: RegisterGitServer, actor: Actor): Promise<GitServerRecord> {
    const existing = await this.#mustGetServer(id);
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

  /** The branches of a registered repository on its server, and the one the server calls its default. */
  async listBranches(id: string): Promise<RepositoryBranches> {
    const repository = await this.getRepository(id);
    const probe = await this.#probeRepository(repository);
    return { branches: probe.branches, ...(probe.defaultBranch === undefined ? {} : { remoteDefault: probe.defaultBranch }), ...(repository.defaultBranch === undefined ? {} : { current: repository.defaultBranch }) };
  }

  /**
   * Chooses the branch Kintsugi follows (the "main" branch: what is mirrored, analysed and where documents are
   * written). It must exist on the server; the repository goes back to `pending` and the worker syncs it.
   */
  async setRepositoryBranch(id: string, branch: string, actor: Actor): Promise<GitRepositoryRecord> {
    const existing = await this.getRepository(id);
    if (existing.defaultBranch === branch) return existing;
    const probe = await this.#probeRepository(existing);
    if (!probe.branches.includes(branch)) throw new BadRequestException(`${branch} is not a branch of ${auditUrl(existing.url)}`);
    const updated = await this.registry.setRepositoryBranch(id, branch);
    if (updated === undefined) throw new NotFoundException(`Repository ${id} not found`);
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.gitRepositoryUpdate, { subject: id, detail: { serverId: existing.serverId, url: auditUrl(existing.url), from: existing.defaultBranch ?? null, to: branch } }),
    );
    return updated;
  }

  async #probeRepository(repository: GitRepositoryRecord): Promise<RemoteProbe> {
    const server = await this.#mustGetServer(repository.serverId);
    const problem = repositoryUrlProblem(repository.url, server);
    if (problem !== undefined) throw new BadRequestException(problem);
    try {
      return await this.remote.probe(repository.url, (await this.registry.serverAccess(repository.serverId))!);
    } catch (error) {
      throw new BadRequestException(`Cannot reach ${auditUrl(repository.url)}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
