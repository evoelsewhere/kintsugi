// A Git server's credential is only ever sent to its own host (ADR-0025).

import { describe, expect, it } from "vitest";
import { pinnedHosts, remoteLocation, repositoryUrlProblem } from "../../src/modules/admin/git/domain/git.js";

describe("remote locations", () => {
  it("reads https, ssh and scp-like URLs", () => {
    expect(remoteLocation("https://GitHub.com/org/repo.git")).toEqual({ protocol: "https", host: "github.com" });
    expect(remoteLocation("ssh://git@ssh.dev.azure.com/v3/org/p/r")).toEqual({ protocol: "ssh", host: "ssh.dev.azure.com" });
    expect(remoteLocation("git@gitlab.example.com:group/repo.git")).toEqual({ protocol: "ssh", host: "gitlab.example.com" });
    expect(remoteLocation("file:///srv/repo.git")).toBeUndefined();
    expect(remoteLocation("ext::sh -c touch% /tmp/x")).toBeUndefined();
  });

  it("lists the hosts a known_hosts text pins", () => {
    const hosts = pinnedHosts("# comment\ngithub.com,140.82.112.3 ssh-ed25519 AAAA\n[git.internal]:2222 ssh-rsa AAAA\n@revoked bad.example ssh-rsa AAAA\n");
    expect([...hosts].sort()).toEqual(["140.82.112.3", "git.internal", "github.com"]);
  });
});

describe("repository URL rules", () => {
  const token = { baseUrl: "https://gitlab.example.com", authType: "token" as const };
  const ssh = { baseUrl: "https://dev.azure.com/org", authType: "ssh-key" as const, knownHosts: "ssh.dev.azure.com ssh-rsa AAAA" };

  it("accepts repositories on the credential's own host", () => {
    expect(repositoryUrlProblem("https://gitlab.example.com/group/repo.git", token)).toBeUndefined();
    expect(repositoryUrlProblem("git@ssh.dev.azure.com:v3/org/project/repo", ssh)).toBeUndefined();
  });

  it("refuses other hosts, plain http with a token, and mismatched protocols", () => {
    expect(repositoryUrlProblem("https://evil.example.com/group/repo.git", token)).toMatch(/does not match/);
    expect(repositoryUrlProblem("http://gitlab.example.com/group/repo.git", token)).toMatch(/only sent over HTTPS/);
    expect(repositoryUrlProblem("git@gitlab.example.com:group/repo.git", token)).toMatch(/HTTPS clone URL/);
    expect(repositoryUrlProblem("https://dev.azure.com/org/p/_git/r", ssh)).toMatch(/SSH clone URL/);
    expect(repositoryUrlProblem("git@evil.example.com:org/repo.git", ssh)).toMatch(/No SSH host key is pinned/);
  });
});
