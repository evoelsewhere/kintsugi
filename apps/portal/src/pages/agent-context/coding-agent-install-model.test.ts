import { describe, expect, it } from "vitest";
import {
  buildPluginInstallCommand,
  parseCodingAgentAuthorizationRequest,
  safeCodingAgentReturnTo,
  validatedAuthorizationRedirect,
} from "./coding-agent-install-model";

describe("project plugin install command", () => {
  it("uses the configured Kintsugi URL and selected project in one command", () => {
    expect(buildPluginInstallCommand({
      baseUrl: "https://kintsugi.example/tenant",
      projectId: "billing-api",
      harness: "claude-code",
      profileId: "kintsugi-billing-api",
      shell: "powershell",
    })).toBe("kintsugi plugins setup --harness claude-code --url 'https://kintsugi.example/tenant' --project 'billing-api' --profile 'kintsugi-billing-api'");
  });

  it("quotes project IDs safely for PowerShell and POSIX shells", () => {
    const input = { baseUrl: "http://localhost:8080", projectId: "bill ' api & web", harness: "codex" as const, profileId: "kintsugi-billing", shell: "powershell" as const };
    expect(buildPluginInstallCommand(input)).toContain("--project 'bill '' api & web'");
    expect(buildPluginInstallCommand({ ...input, shell: "posix" })).toContain("--project 'bill '\\'' api & web'");
  });

  it("rejects noncanonical or unsafe installation URLs and malformed identifiers", () => {
    for (const baseUrl of ["https://user:pass@kintsugi.example", "https://kintsugi.example/?next=x", "https://kintsugi.example/#x", "http://kintsugi.example"]) {
      expect(() => buildPluginInstallCommand({ baseUrl, projectId: "billing", harness: "codex", shell: "posix" })).toThrow();
    }
    expect(() => buildPluginInstallCommand({ baseUrl: "https://kintsugi.example", projectId: "\nbad", harness: "codex", shell: "posix" })).toThrow();
  });

  it("rejects unsupported clients or shells if the UI selector is bypassed", () => {
    expect(() => buildPluginInstallCommand({ baseUrl: "https://kintsugi.example", projectId: "billing", harness: "other" as never, shell: "posix" })).toThrow("Choose a supported AI client");
    expect(() => buildPluginInstallCommand({ baseUrl: "https://kintsugi.example", projectId: "billing", harness: "codex", shell: "cmd" as never })).toThrow("Choose a supported terminal shell");
  });

  it("never includes an access token or refresh credential", () => {
    const command = buildPluginInstallCommand({ baseUrl: "https://kintsugi.example", projectId: "billing", harness: "codex", shell: "posix" });
    expect(command).not.toMatch(/knt_(?:caw|crt)_/);
    expect(command).not.toContain("token");
  });
});

describe("Coding Agent Workflow consent handoff", () => {
  const request = "?projectId=billing&clientName=Kintsugi+CLI&redirectUri=http%3A%2F%2F127.0.0.1%3A49152%2Foauth%2Fcallback&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&codeChallenge=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&codeChallengeMethod=S256";

  it("parses a complete PKCE request and rejects missing, duplicate, or unsupported fields", () => {
    expect(parseCodingAgentAuthorizationRequest(request)).toMatchObject({ projectId: "billing", clientName: "Kintsugi CLI", codeChallengeMethod: "S256" });
    expect(parseCodingAgentAuthorizationRequest("?projectId=billing")).toBeUndefined();
    expect(parseCodingAgentAuthorizationRequest(request + "&state=other")).toBeUndefined();
    expect(parseCodingAgentAuthorizationRequest(request + "&next=https://evil.example")).toBeUndefined();
  });

  it("preserves only a local coding-agent authorization URL through login", () => {
    expect(safeCodingAgentReturnTo(`/coding-agent/authorize${request}`)).toBe(`/coding-agent/authorize${request}`);
    for (const unsafe of ["https://evil.example", "//evil.example/coding-agent/authorize", "/\\evil.example/coding-agent/authorize", "/projects?next=https://evil.example", null]) {
      expect(safeCodingAgentReturnTo(unsafe)).toBe("/");
    }
  });

  it("accepts only the expected one-use loopback callback with the original state", () => {
    const parsed = parseCodingAgentAuthorizationRequest(request)!;
    expect(validatedAuthorizationRedirect("http://127.0.0.1:49152/oauth/callback?code=knt_ac_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", parsed)).toContain("code=knt_ac_");
    expect(() => validatedAuthorizationRedirect("https://evil.example/callback?code=abc&state=" + parsed.state, parsed)).toThrow();
    expect(() => validatedAuthorizationRedirect("http://127.0.0.1:49152/oauth/callback?code=abc&state=wrong", parsed)).toThrow();
  });
});
