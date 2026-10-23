// Domain of Git servers and repositories (A3, ADR-0007, ADR-0025): users register a
// repository URL plus a server credential; Kintsugi clones into its own storage.
// Pure types and rules — no framework, no I/O.

import type { GitServerKind } from "@kintsugi/domain";

export type GitAuthType = "none" | "token" | "ssh-key";

export interface GitServerRecord {
  id: string;
  kind: GitServerKind;
  name: string;
  /** Web/API base URL, e.g. https://github.com or https://dev.azure.com/org. */
  baseUrl: string;
  authType: GitAuthType;
  /** HTTPS username sent with the token; most servers ignore it. */
  username?: string;
  /** Pinned SSH host keys (known_hosts lines); public data. */
  knownHosts?: string;
  /** Whether the write-only credential (token or SSH key) is stored. */
  hasCredential: boolean;
  /** Whether a write-only GitHub webhook secret is stored for event-driven PR refresh. */
  hasGithubWebhookSecret: boolean;
  /** GitHub App metadata is visible, but its PEM private key remains write-only. */
  githubApp?: GitHubAppConfigRecord;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubAppConfigRecord {
  appId: string;
  installationId: string;
  hasPrivateKey: boolean;
}

/** Write-only server-side GitHub App configuration. */
export interface GitHubAppRegistration {
  appId: string;
  installationId: string;
  privateKey: string;
}

/** Write-only credential material; stored encrypted, never returned. */
export interface GitServerCredential {
  token?: string;
  privateKey?: string;
}

export interface RegisterGitServer {
  id: string;
  kind: GitServerKind;
  name: string;
  baseUrl: string;
  authType: GitAuthType;
  username?: string;
  knownHosts?: string;
  credential: GitServerCredential;
  /** Omitted keeps the stored value; null clears it. Plaintext is encrypted and never returned. */
  githubWebhookSecret?: string | null;
  /** Omitted on replacement to keep it; null removes the App integration. */
  githubApp?: GitHubAppRegistration | null;
}

export type SyncStatus = "pending" | "cloning" | "ready" | "error";

export interface GitRepositoryRecord {
  id: string;
  serverId: string;
  /** Clone URL (https or ssh); never carries credentials. */
  url: string;
  defaultBranch?: string;
  /** Set by the worker's sync (ADR-0025); `pending` until the first clone. */
  syncStatus: SyncStatus;
  lastCommit?: string;
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterGitRepository {
  id: string;
  serverId: string;
  url: string;
  defaultBranch?: string;
}

/** A repository still used by a project cannot be removed: unlink it first (ADR-0028). */
export class RepositoryInUseError extends Error {}

/** Everything needed to reach a server for one call, in plaintext — infrastructure only. */
export interface GitAccess {
  authType: GitAuthType;
  username?: string;
  token?: string;
  privateKey?: string;
  knownHosts?: string;
}

/** What "Test access" learned from the remote. */
export interface RemoteProbe {
  defaultBranch?: string;
  branchCount: number;
  /** Branch names, sorted. */
  branches: string[];
}

export interface RemoteLocation {
  protocol: "https" | "http" | "ssh";
  host: string;
}

/** Protocol and host of a clone URL: https://…, ssh://…, or scp-like user@host:path. */
export function remoteLocation(url: string): RemoteLocation | undefined {
  const scp = /^[a-z0-9._-]+@([a-z0-9.-]+):(?!\/\/)/i.exec(url);
  if (scp !== null) return { protocol: "ssh", host: scp[1]!.toLowerCase() };
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.slice(0, -1);
    if (protocol !== "https" && protocol !== "http" && protocol !== "ssh") return undefined;
    return { protocol, host: parsed.hostname.toLowerCase() };
  } catch {
    return undefined;
  }
}

/** Host names a known_hosts text pins (first field; `[host]:port` and comma lists). */
export function pinnedHosts(knownHosts: string | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const line of (knownHosts ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("@")) continue;
    for (const entry of trimmed.split(/\s+/)[0]!.split(",")) {
      hosts.add(entry.replace(/^\[([^\]]+)\](:\d+)?$/, "$1").toLowerCase());
    }
  }
  return hosts;
}

/** Hosts a token may reach over plain HTTP: the traffic never leaves the machine (a local test Git server). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Why a repository URL cannot use this server's credential, or undefined when it can.
 * A credential is only ever sent to its own server: HTTPS repositories must be on the
 * base URL's host (plain HTTP only on this machine), SSH repositories on a host whose key
 * is pinned for the server.
 */
export function repositoryUrlProblem(url: string, server: Pick<GitServerRecord, "baseUrl" | "authType" | "knownHosts">): string | undefined {
  const location = remoteLocation(url);
  if (location === undefined) return "Repository URLs must use https, ssh, or the user@host:path form.";
  if (location.protocol === "ssh") {
    if (server.authType === "token") return "This server authenticates with a token; use its HTTPS clone URL.";
    if (!pinnedHosts(server.knownHosts).has(location.host)) return `No SSH host key is pinned for ${location.host} on this server.`;
    return undefined;
  }
  if (server.authType === "ssh-key") return "This server authenticates with an SSH key; use its SSH clone URL.";
  if (location.protocol === "http" && server.authType === "token" && !LOOPBACK_HOSTS.has(location.host)) return "Tokens are only sent over HTTPS.";
  const serverHost = remoteLocation(server.baseUrl)?.host;
  if (serverHost !== location.host) return `The repository host ${location.host} does not match the server (${serverHost ?? server.baseUrl}).`;
  return undefined;
}
