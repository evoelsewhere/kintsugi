import { afterEach, describe, expect, it } from "vitest";
import { loadBootstrapAdmin, loadEnv } from "#common/config/env.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("loadBootstrapAdmin", () => {
  it("refuses a missing password (no default credentials)", () => {
    delete process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"];
    expect(() => loadBootstrapAdmin()).toThrow(/KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it("refuses an empty or short password", () => {
    process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] = "";
    expect(() => loadBootstrapAdmin()).toThrow();
    process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] = "1234567";
    expect(() => loadBootstrapAdmin()).toThrow(/at least 8/);
  });

  it("accepts a long enough password and defaults the username to admin", () => {
    delete process.env["KINTSUGI_BOOTSTRAP_ADMIN_USER"];
    process.env["KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD"] = "12345678";
    expect(loadBootstrapAdmin()).toEqual({ username: "admin", password: "12345678" });
  });
});

describe("loadEnv", () => {
  it("marks cookies Secure only for an https public URL", () => {
    process.env["KINTSUGI_PUBLIC_URL"] = "https://kintsugi.example";
    expect(loadEnv().secureCookies).toBe(true);
    process.env["KINTSUGI_PUBLIC_URL"] = "http://localhost:8080";
    expect(loadEnv().secureCookies).toBe(false);
  });
});
