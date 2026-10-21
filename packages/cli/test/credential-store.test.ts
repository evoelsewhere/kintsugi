import { describe, expect, it, vi } from "vitest";
import { NativeCredentialStore } from "../src/credential-store.js";

describe("native credential store", () => {
  it("uses Linux Secret Service directly and never falls back to kernel keyutils", async () => {
    const runner = vi.fn(async (args: string[], _input?: string) => ({ stdout: args[0] === "lookup" ? "TEST-secret\n" : "" }));
    const store = new NativeCredentialStore(undefined, "linux", runner);
    await store.set("work", "TEST-token-value");
    expect(runner).toHaveBeenCalledWith(["store", "--label=Kintsugi CLI credential", "service", "com.kintsugi.cli", "profile", "work"], "TEST-token-value");
    await expect(store.get("work")).resolves.toBe("TEST-secret");
    expect(runner).toHaveBeenCalledWith(["lookup", "service", "com.kintsugi.cli", "profile", "work"]);
  });

  it("fails closed with a sanitized message when the system store is unavailable", async () => {
    const store = new NativeCredentialStore(undefined, "linux", async () => { throw new Error("TEST-secret native error"); });
    await expect(store.get("work")).rejects.toMatchObject({ code: "CREDENTIAL_STORE_UNAVAILABLE" });
    await expect(store.get("work")).rejects.not.toThrow("TEST-secret native error");
  });

  it("uses the native entry only on Windows and macOS", async () => {
    const entry = { getPassword: () => null, setPassword: vi.fn(), deletePassword: vi.fn() };
    const createEntry = vi.fn(() => entry);
    const store = new NativeCredentialStore(createEntry as never, "win32");
    await store.set("work", "TEST-token-value");
    expect(createEntry).toHaveBeenCalledWith("com.kintsugi.cli", "work");
    expect(entry.setPassword).toHaveBeenCalledWith("TEST-token-value");
  });
});
