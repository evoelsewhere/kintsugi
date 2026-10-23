// GitRemote over the git core package (ADR-0025): `git ls-remote` with the server's
// credential for this one call. Errors from @kintsugi/git are already redacted.

import { Injectable } from "@nestjs/common";
import { type GitCredential, isLoopbackUrl, lsRemote } from "@kintsugi/git";
import type { GitAccess, RemoteProbe } from "../domain/git.js";
import { GitRemote } from "../domain/git.ports.js";

const PROBE_TIMEOUT_MS = 30_000;

function credentialOf(access: GitAccess): GitCredential {
  if (access.authType === "token" && access.token !== undefined) {
    return { kind: "token", token: access.token, ...(access.username === undefined ? {} : { username: access.username }) };
  }
  if (access.authType === "ssh-key" && access.privateKey !== undefined) return { kind: "ssh-key", privateKey: access.privateKey };
  return { kind: "none" };
}

@Injectable()
export class CliGitRemote extends GitRemote {
  async probe(url: string, access: GitAccess): Promise<RemoteProbe> {
    const credential = credentialOf(access);
    const info = await lsRemote(url, {
      credential,
      // Plain http only for anonymous servers or a server on this machine; the domain refuses tokens over http elsewhere.
      allowHttp: credential.kind === "none" || isLoopbackUrl(url),
      remoteUrl: url,
      ...(access.knownHosts === undefined ? {} : { knownHosts: access.knownHosts }),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return {
      ...(info.defaultBranch === undefined ? {} : { defaultBranch: info.defaultBranch }),
      branchCount: info.branches.length,
      branches: info.branches.map((branch) => branch.name).sort(),
    };
  }
}
