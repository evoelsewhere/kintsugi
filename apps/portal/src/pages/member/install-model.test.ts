import { describe, expect, it } from "vitest";
import {
  buildSetupCommands,
  memberAuthorizationPayload,
  parseMemberAuthorizationRequest,
  safeMemberReturnTo,
  validatedAuthorizationRedirect,
} from "./install-model";

describe("setup commands", () => {
  it("are sign in, init and install, with the project", () => {
    expect(buildSetupCommands({ baseUrl: "https://kintsugi.example/tenant", projectId: "billing-api", shell: "powershell" })).toEqual([
      "kintsugi login billing-api",
      "kintsugi init",
      "kintsugi install plugin modernize --all",
    ]);
    expect(buildSetupCommands({ baseUrl: "https://kintsugi.example", projectId: "billing-api", shell: "posix", plugin: "other_plugin" })[2]).toBe("kintsugi install plugin other_plugin --all");
  });

  it("adds the URL only on request", () => {
    expect(buildSetupCommands({ baseUrl: "http://127.0.0.1:5175", projectId: "test", shell: "powershell", withUrl: true })[0]).toBe("kintsugi login test --url 'http://127.0.0.1:5175'");
  });

  it("quotes only a project ID that needs it, for PowerShell and POSIX shells", () => {
    const input = { baseUrl: "http://localhost:8080", projectId: "bill ' api & web", shell: "powershell" as const };
    expect(buildSetupCommands(input)[0]).toBe("kintsugi login 'bill '' api & web'");
    expect(buildSetupCommands({ ...input, shell: "posix" })[0]).toBe("kintsugi login 'bill '\\'' api & web'");
  });

  it("rejects noncanonical or unsafe installation URLs, malformed identifiers and unsupported shells", () => {
    for (const baseUrl of ["https://user:pass@kintsugi.example", "https://kintsugi.example/?next=x", "https://kintsugi.example/#x", "http://kintsugi.example"]) {
      expect(() => buildSetupCommands({ baseUrl, projectId: "billing", shell: "posix" })).toThrow();
    }
    expect(() => buildSetupCommands({ baseUrl: "https://kintsugi.example", projectId: "\nbad", shell: "posix" })).toThrow();
    expect(() => buildSetupCommands({ baseUrl: "https://kintsugi.example", projectId: "billing", shell: "cmd" as never })).toThrow("Choose a supported terminal shell");
    expect(() => buildSetupCommands({ baseUrl: "https://kintsugi.example", projectId: "billing", shell: "posix", plugin: "x; rm -rf ~" })).toThrow("plugin name");
  });

  it("never includes an access token or refresh credential", () => {
    const commands = buildSetupCommands({ baseUrl: "https://kintsugi.example", projectId: "billing", shell: "posix", withUrl: true }).join("\n");
    expect(commands).not.toMatch(/knt_(?:caw|crt)_/);
    expect(commands).not.toContain("token");
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
