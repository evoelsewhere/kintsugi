// Application layer: use cases of Git servers and repositories (Settings → Git).
// Depends on the domain ports only; knows nothing about HTTP, Postgres or the git CLI.

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page, PageQuery } from "../../../../common/application/pagination.js";
import { toPage } from "../../../../common/application/pagination.js";
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

@Injectable()
export class GitService {
  constructor(
    private readonly registry: GitRegistry,
    private readonly remote: GitRemote,
  ) {}

  // ---- servers ----

  async listServers(query: PageQuery): Promise<Page<GitServerRecord>> {
    const servers = await this.registry.listServers();
    return toPage(servers.slice(query.offset, query.offset + query.limit), servers.length, query);
  }

  getServer(id: string): Promise<GitServerRecord> {
    return this.#mustGetServer(id);
  }

  async createServer(input: RegisterGitServer): Promise<GitServerRecord> {
    if ((await this.registry.getServer(input.id)) !== undefined) throw new ConflictException(`Git server ${input.id} already exists`);
    const problem = credentialProblem(input);
    if (problem !== undefined) throw new BadRequestException(problem);
    return this.registry.createServer(input);
  }

  async replaceServer(id: string, input: RegisterGitServer): Promise<GitServerRecord> {
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
    return updated;
  }

  async removeServer(id: string): Promise<void> {
    await this.#mustGetServer(id);
    const repositories = await this.registry.countRepositories(id);
    if (repositories > 0) throw new ConflictException(`Git server ${id} still has ${repositories} repositories; remove them first`);
    await this.registry.removeServer(id);
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
  async createRepository(input: Omit<RegisterGitRepository, "defaultBranch">): Promise<GitRepositoryRecord> {
    if ((await this.registry.getRepository(input.id)) !== undefined) throw new ConflictException(`Repository ${input.id} already exists`);
    if ((await this.registry.findRepositoryByUrl(input.url)) !== undefined) throw new ConflictException(`${input.url} is already registered`);
    const access = await this.testAccess(input.serverId, input.url);
    if (!access.ok) throw new BadRequestException(`Cannot reach ${input.url}: ${access.message}`);
    return this.registry.createRepository({ ...input, ...(access.defaultBranch === undefined ? {} : { defaultBranch: access.defaultBranch }) });
  }

  async removeRepository(id: string): Promise<void> {
    let removed: boolean;
    try {
      removed = await this.registry.removeRepository(id);
    } catch (error) {
      if (error instanceof RepositoryInUseError) throw new ConflictException(error.message);
      throw error;
    }
    if (!removed) throw new NotFoundException(`Repository ${id} not found`);
  }

  async #mustGetServer(id: string): Promise<GitServerRecord> {
    const server = await this.registry.getServer(id);
    if (server === undefined) throw new NotFoundException(`Git server ${id} not found`);
    return server;
  }
}
