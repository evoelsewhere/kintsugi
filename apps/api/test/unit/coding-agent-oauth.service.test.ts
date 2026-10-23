import { describe, expect, it } from "vitest";
import { parseLoopbackRedirect, pkceChallengeForVerifier } from "../../src/modules/core/auth/application/coding-agent-oauth.service.js";

describe("Kintsugi member OAuth primitives", () => {
  it("derives the RFC 7636 S256 challenge from a verifier", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallengeForVerifier(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("accepts only an explicit loopback callback URI", () => {
    expect(parseLoopbackRedirect("http://127.0.0.1:43127/oauth/callback").toString()).toBe("http://127.0.0.1:43127/oauth/callback");
    expect(parseLoopbackRedirect("http://[::1]:43127/oauth/callback").hostname).toBe("[::1]");
    for (const value of [
      "https://127.0.0.1:43127/oauth/callback",
      "http://localhost:43127/oauth/callback",
      "http://127.0.0.1/oauth/callback",
      "http://127.0.0.1:43127/other",
      "http://127.0.0.1:43127/oauth/callback?next=https://attacker.example",
    ]) {
      expect(() => parseLoopbackRedirect(value)).toThrow();
    }
  });
});
