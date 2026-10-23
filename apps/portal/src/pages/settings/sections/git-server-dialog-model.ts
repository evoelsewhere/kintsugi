import type { GitServerKind } from "@kintsugi/domain";
import type { GitServerInput, GitServerView } from "@/lib/api/git";

export interface GitHubAppDraft {
  enabled: boolean;
  appId: string;
  installationId: string;
  privateKey: string;
}

export type GitHubAppInputDecision = Pick<GitServerInput, "githubApp"> | { error: string };

/** Decide whether to preserve, replace, or explicitly remove a server's write-only App config. */
export function githubAppInputProblem(input: {
  kind: GitServerKind;
  baseUrl: string;
  server: GitServerView | null;
  draft: GitHubAppDraft;
}): GitHubAppInputDecision {
  const existing = input.server?.githubApp;
  if (!input.draft.enabled) return existing === undefined ? {} : { githubApp: null };

  if (input.kind !== "github" && input.kind !== "github-enterprise") {
    return { error: "GitHub App credentials are available only for GitHub.com or GitHub Enterprise." };
  }
  if (
    !/^\d+$/.test(input.draft.appId.trim()) ||
    input.draft.appId.trim().length > 30 ||
    !/^\d+$/.test(input.draft.installationId.trim()) ||
    input.draft.installationId.trim().length > 30
  ) {
    return { error: "GitHub App and installation IDs must be numeric." };
  }
  let base: URL;
  try {
    base = new URL(input.baseUrl.trim());
  } catch {
    return { error: "GitHub App credentials require the matching HTTPS GitHub host URL." };
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
  ) {
    return { error: "GitHub App credentials require the matching HTTPS GitHub host URL." };
  }

  const appId = input.draft.appId.trim();
  const installationId = input.draft.installationId.trim();
  const sameStoredApp = existing?.appId === appId && existing.installationId === installationId && existing.hasPrivateKey;
  const privateKey = input.draft.privateKey.trim();
  if (privateKey === "" && sameStoredApp) return {};
  if (privateKey === "") return { error: "Enter the GitHub App private key." };

  return { githubApp: { appId, installationId, privateKey } };
}
