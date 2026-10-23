// Ports of the Git module. Implemented by infrastructure adapters (Postgres registry,
// the git CLI); the application layer depends only on these contracts.

import type { GitAccess, GitRepositoryRecord, GitServerRecord, RegisterGitRepository, RegisterGitServer, RemoteProbe } from "./git.js";

/** Registered Git servers and repositories, with encrypted server credentials. */
export abstract class GitRegistry {
  abstract listServers(): Promise<GitServerRecord[]>;
  abstract getServer(id: string): Promise<GitServerRecord | undefined>;
  abstract createServer(input: RegisterGitServer): Promise<GitServerRecord>;
  /** Replaces the server; credentials absent from `input` are kept. */
  abstract replaceServer(id: string, input: RegisterGitServer): Promise<GitServerRecord | undefined>;
  abstract removeServer(id: string): Promise<boolean>;
  /** Plaintext access for one Git call — "Test access" and the worker only. */
  abstract serverAccess(id: string): Promise<GitAccess | undefined>;
  /** Decrypted only by the signed GitHub webhook verifier; undefined disables inbound webhook delivery. */
  abstract githubWebhookSecret(id: string): Promise<string | undefined>;

  abstract listRepositories(): Promise<GitRepositoryRecord[]>;
  abstract getRepository(id: string): Promise<GitRepositoryRecord | undefined>;
  abstract findRepositoryByUrl(url: string): Promise<GitRepositoryRecord | undefined>;
  abstract countRepositories(serverId: string): Promise<number>;
  abstract createRepository(input: RegisterGitRepository): Promise<GitRepositoryRecord>;
  /** Sets the branch Kintsugi follows and marks the repository `pending`: the worker syncs it again. */
  abstract setRepositoryBranch(id: string, branch: string): Promise<GitRepositoryRecord | undefined>;
  /** Rejects with RepositoryInUseError while a project links the repository. */
  abstract removeRepository(id: string): Promise<boolean>;
}

/** Talks to a remote without cloning it. */
export abstract class GitRemote {
  /** Lists the remote's branches; rejects with a message safe to show (no credentials). */
  abstract probe(url: string, access: GitAccess): Promise<RemoteProbe>;
}
