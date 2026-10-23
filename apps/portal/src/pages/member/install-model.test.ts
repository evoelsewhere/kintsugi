import { describe, expect, it } from "vitest";
import {
  buildPluginInstallCommand,
  memberAuthorizationPayload,
  parseMemberAuthorizationRequest,
  safeMemberReturnTo,
  validatedAuthorizationRedirect,
} from "./install-model";

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

  it("prepares the Codex Desktop marketplace without claiming that the app installed the plugin", () => {
    expect(buildPluginInstallCommand({
      baseUrl: "http://127.0.0.1:5175",
      projectId: "test",
      harness: "codex",
      installMode: "desktop-ui",
      profileId: "kintsugi-test",
      shell: "powershell",
    })).toBe("kintsugi plugins setup --install-mode desktop-ui --harness codex --url 'http://127.0.0.1:5175' --project 'test' --profile 'kintsugi-test'");
    expect(() => buildPluginInstallCommand({ baseUrl: "https://kintsugi.example", projectId: "billing", harness: "claude-code", installMode: "desktop-ui", shell: "posix" })).toThrow("Codex Desktop");
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

describe("member consent handoff", () => {
  const request = "?projectId=billing&clientName=Kintsugi+CLI&redirectUri=http%3A%2F%2F127.0.0.1%3A49152%2Foauth%2Fcallback&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&codeChallenge=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB&codeChallengeMethod=S256";

  it("parses a complete PKCE request and rejects missing, duplicate, or unsupported fields", () => {
    expect(parseMemberAuthorizationRequest(request)).toMatchObject({ projectId: "billing", clientName: "Kintsugi CLI", codeChallengeMethod: "S256" });
    expect(parseMemberAuthorizationRequest("?projectId=billing")).toBeUndefined();
    expect(parseMemberAuthorizationRequest(request + "&state=other")).toBeUndefined();
    expect(parseMemberAuthorizationRequest(request + "&next=https://evil.example")).toBeUndefined();
  });

  it("carries the sign-in expiry so the approval screen can show time remaining", () => {
    const expiresAt = Date.now() + 90_000;
    const parsed = parseMemberAuthorizationRequest(`${request}&expiresAt=${expiresAt}`)!;
    expect(parsed).toMatchObject({ expiresAt });
    expect(memberAuthorizationPayload(parsed)).not.toHaveProperty("expiresAt");
    expect(parseMemberAuthorizationRequest(`${request}&expiresAt=${expiresAt}&expiresAt=${expiresAt + 1}`)).toBeUndefined();
    expect(parseMemberAuthorizationRequest(`${request}&expiresAt=soon`)).toBeUndefined();
    expect(parseMemberAuthorizationRequest(`${request}&expiresAt=${Date.now() + 130_000}`)).toBeUndefined();
  });
  it("preserves only a local coding-agent authorization URL through login", () => {
    const expiringRequest = `${request}&expiresAt=${Date.now() + 90_000}`;
    expect(safeMemberReturnTo(`/member/authorize${expiringRequest}`)).toBe(`/member/authorize${expiringRequest}`);
    for (const unsafe of ["https://evil.example", "//evil.example/member/authorize", "/\\evil.example/member/authorize", "/projects?next=https://evil.example", null]) {
      expect(safeMemberReturnTo(unsafe)).toBe("/");
    }
  });

  it("accepts only the expected one-use loopback callback with the original state", () => {
    const parsed = parseMemberAuthorizationRequest(request)!;
    expect(validatedAuthorizationRedirect("http://127.0.0.1:49152/oauth/callback?code=knt_ac_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", parsed)).toContain("code=knt_ac_");
    expect(() => validatedAuthorizationRedirect("https://evil.example/callback?code=abc&state=" + parsed.state, parsed)).toThrow();
    expect(() => validatedAuthorizationRedirect("http://127.0.0.1:49152/oauth/callback?code=abc&state=wrong", parsed)).toThrow();
  });
});
