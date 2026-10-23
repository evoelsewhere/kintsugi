import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProfileStore, validateInstallationUrl } from "../src/profile.js";

let directory: string | undefined;
afterEach(async () => { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe("local profile configuration", () => {
  it("stores only validated nonsecret profile data with private file permissions", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-profile-"));
    const path = join(directory, "config.json");
    const store = new FileProfileStore(path);
    await store.save({ schemaVersion: "1", activeProfile: "work", profiles: { work: { id: "work", baseUrl: "https://kintsugi.example/base", projectId: "shop" } } });
    const content = await readFile(path, "utf8");
    expect(content).toContain("https://kintsugi.example/base");
    expect(content).not.toContain("token");
    expect(await store.load()).toMatchObject({ activeProfile: "work", profiles: { work: { projectId: "shop" } } });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("accepts only HTTPS for remote installations and HTTP on loopback", () => {
    expect(validateInstallationUrl("http://127.0.0.1:3000/" )).toBe("http://127.0.0.1:3000");
    expect(() => validateInstallationUrl("http://kintsugi.example")).toThrow("HTTPS");
    expect(() => validateInstallationUrl("https://user:secret@kintsugi.example")).toThrow("credentials");
  });

  it("refuses a symlinked profile file", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-profile-link-"));
    const target = join(directory, "target.json");
    const path = join(directory, "config.json");
    await writeFile(target, JSON.stringify({ schemaVersion: "1", profiles: {} }));
    try { await symlink(target, path); } catch { return; }
    await expect(new FileProfileStore(path).load()).rejects.toMatchObject({ code: "PROFILE_PATH_UNSAFE" });
  });
});
