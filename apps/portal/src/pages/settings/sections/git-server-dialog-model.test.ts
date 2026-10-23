import { describe, expect, it } from "vitest";
import type { GitServerView } from "@/lib/api/git";
import { githubAppInputProblem } from "./git-server-dialog-model";

const existing = {
  id: "github",
  kind: "github",
  name: "GitHub",
  baseUrl: "https://github.com",
  authType: "token",
  hasCredential: true,
  hasGithubWebhookSecret: false,
  githubApp: { appId: "12345", installationId: "67890", hasPrivateKey: true },
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
} satisfies GitServerView;

describe("githubAppInputProblem", () => {
  it("leaves the stored App config alone when enabled without changing its IDs or key", () => {
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: existing,
      draft: { enabled: true, appId: "12345", installationId: "67890", privateKey: "" },
    })).toEqual({});
  });

  it("requires a fresh private key when adding an App or changing its identity", () => {
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: null,
      draft: { enabled: true, appId: "12345", installationId: "67890", privateKey: "" },
    })).toEqual({ error: "Enter the GitHub App private key." });
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: existing,
      draft: { enabled: true, appId: "12345", installationId: "67891", privateKey: "" },
    })).toEqual({ error: "Enter the GitHub App private key." });
  });

  it("submits new configuration only with numeric IDs and a private key", () => {
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: null,
      draft: { enabled: true, appId: "12x", installationId: "67890", privateKey: "pem" },
    })).toEqual({ error: "GitHub App and installation IDs must be numeric." });
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: null,
      draft: { enabled: true, appId: " 12345 ", installationId: "67890", privateKey: "  pem  " },
    })).toEqual({ githubApp: { appId: "12345", installationId: "67890", privateKey: "pem" } });
  });

  it("explicitly clears an existing App config when disabled", () => {
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: existing,
      draft: { enabled: false, appId: "12345", installationId: "67890", privateKey: "" },
    })).toEqual({ githubApp: null });
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.com",
      server: null,
      draft: { enabled: false, appId: "", installationId: "", privateKey: "" },
    })).toEqual({});
  });

  it("validates the App kind and registered GitHub host", () => {
    expect(githubAppInputProblem({
      kind: "gitlab",
      baseUrl: "https://github.com",
      server: null,
      draft: { enabled: true, appId: "1", installationId: "2", privateKey: "pem" },
    })).toEqual({ error: "GitHub App credentials are available only for GitHub.com or GitHub Enterprise." });
    expect(githubAppInputProblem({
      kind: "github",
      baseUrl: "https://github.example.com",
      server: null,
      draft: { enabled: true, appId: "1", installationId: "2", privateKey: "pem" },
    })).toEqual({ error: "GitHub App credentials require the matching HTTPS GitHub host URL." });
    expect(githubAppInputProblem({
      kind: "github-enterprise",
      baseUrl: "https://github.example.com/enterprise",
      server: null,
      draft: { enabled: true, appId: "1", installationId: "2", privateKey: "pem" },
    })).toEqual({ error: "GitHub App credentials require the matching HTTPS GitHub host URL." });
  });
});
