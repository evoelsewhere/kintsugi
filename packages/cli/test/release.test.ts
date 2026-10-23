import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildRelease, type ReleaseManifest } from "../src/release/build.js";
import { fetchPackageFiles } from "../src/release/registry.js";
import { createTarGz, readTarGz } from "../src/release/tar.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "kintsugi-release-"));
  folders.push(folder);
  return folder;
}

/** A registry serving one npm tarball per package name, with a correct (or a wrong) integrity hash. */
function registry(packages: Record<string, Record<string, string>>, options: { wrongIntegrity?: boolean } = {}): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(".tgz")) {
      const name = decodeURIComponent(url.split("/").at(-1)!.replace(".tgz", ""));
      return new Response(new Uint8Array(createTarGz(Object.entries(packages[name]!).map(([path, content]) => ({ path: `package/${path}`, data: Buffer.from(content) })))));
    }
    const name = decodeURIComponent(url.split("/").slice(-2)[0]!);
    const tarball = createTarGz(Object.entries(packages[name] ?? {}).map(([path, content]) => ({ path: `package/${path}`, data: Buffer.from(content) })));
    const integrity = options.wrongIntegrity === true ? "sha512-AAAA" : `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    return Response.json({ dist: { tarball: `https://registry.example/${encodeURIComponent(name)}.tgz`, integrity } });
  }) as typeof globalThis.fetch;
}

describe("tar", () => {
  it("round-trips files, modes and long paths", () => {
    const longPath = `kintsugi/node_modules/zod/${"nested/".repeat(18)}file.js`;
    const archive = createTarGz([
      { path: "kintsugi/bin/kintsugi", data: Buffer.from("#!/bin/sh\n"), mode: 0o755 },
      { path: longPath, data: Buffer.from("x".repeat(1500)) },
      { path: "kintsugi/VERSION", data: Buffer.from("0.1.0\n") },
    ]);
    const entries = readTarGz(archive);
    expect(entries.map((entry) => entry.path)).toEqual(["kintsugi/VERSION", "kintsugi/bin/kintsugi", longPath].sort());
    expect(entries.find((entry) => entry.path === "kintsugi/bin/kintsugi")).toMatchObject({ mode: 0o755 });
    expect(entries.find((entry) => entry.path === longPath)!.data.length).toBe(1500);
  });

  it("is reproducible and refuses unsafe paths", () => {
    const entries = [{ path: "a/b.txt", data: Buffer.from("same") }];
    expect(createTarGz(entries).equals(createTarGz(entries))).toBe(true);
    for (const path of ["../escape", "/absolute", "a//b", "a\\b", ""]) expect(() => createTarGz([{ path, data: Buffer.alloc(0) }])).toThrow("Unsafe archive path");
  });
});

describe("registry", () => {
  it("returns the files of a package without the package/ prefix and checks the integrity hash", async () => {
    const files = await fetchPackageFiles("@napi-rs/keyring-win32-x64-msvc", "2.0.0", registry({ "@napi-rs/keyring-win32-x64-msvc": { "keyring.win32-x64-msvc.node": "binary" } }));
    expect([...files.keys()]).toEqual(["keyring.win32-x64-msvc.node"]);
    await expect(fetchPackageFiles("x", "1.0.0", registry({ x: { "a.js": "a" } }, { wrongIntegrity: true }))).rejects.toThrow("integrity");
  });
});

describe("buildRelease", () => {
  async function build(outDir: string, fetcher = registry({ "@napi-rs/keyring-win32-x64-msvc": { "keyring.win32-x64-msvc.node": "addon", "package.json": "{}" } })): Promise<ReleaseManifest> {
    const entry = join(outDir, "main.js");
    await writeFile(entry, "console.log('kintsugi');\n");
    return buildRelease({ entry, packageDir, outDir: join(outDir, "out"), version: "9.9.9", platforms: ["linux-x64", "win32-x64"], fetch: fetcher, now: new Date("2026-10-23T00:00:00Z") });
  }

  it("writes a package per platform and a manifest with their hashes", async () => {
    const dir = await temp();
    const manifest = await build(dir);
    expect(manifest).toMatchObject({ schemaVersion: "1", version: "9.9.9", minNode: "22.19.0", builtAt: "2026-10-23T00:00:00.000Z" });
    expect(manifest.assets.map((asset) => asset.platform)).toEqual(["linux-x64", "win32-x64"]);
    expect(JSON.parse(await readFile(join(dir, "out", "9.9.9", "manifest.json"), "utf8"))).toEqual(manifest);
    for (const asset of manifest.assets) {
      const bytes = await readFile(join(dir, "out", "9.9.9", asset.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
      expect(bytes.length).toBe(asset.size);
    }
  });

  it("packs the bundle, a launcher, zod, and the keyring addon only where the platform uses it", async () => {
    const dir = await temp();
    const manifest = await build(dir);
    const read = async (platform: string) => readTarGz(await readFile(join(dir, "out", "9.9.9", manifest.assets.find((asset) => asset.platform === platform)!.file)));
    const linux = await read("linux-x64");
    const windows = await read("win32-x64");
    for (const entries of [linux, windows]) {
      const paths = entries.map((entry) => entry.path);
      expect(paths).toEqual(expect.arrayContaining(["kintsugi/bin/kintsugi", "kintsugi/bin/kintsugi.cmd", "kintsugi/lib/kintsugi.mjs", "kintsugi/package.json", "kintsugi/VERSION", "kintsugi/node_modules/zod/package.json"]));
      expect(entries.find((entry) => entry.path === "kintsugi/bin/kintsugi")!.mode).toBe(0o755);
      expect(entries.find((entry) => entry.path === "kintsugi/bin/kintsugi.cmd")!.data.toString()).toContain("\r\n");
      expect(paths.some((path) => path.startsWith("kintsugi/node_modules/zod/") && /\.(?:d\.ts|cjs|map)$/.test(path))).toBe(false);
    }
    expect(linux.some((entry) => entry.path.includes("@napi-rs"))).toBe(false);
    expect(windows.map((entry) => entry.path)).toEqual(expect.arrayContaining(["kintsugi/node_modules/@napi-rs/keyring/package.json", "kintsugi/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node"]));
    expect(windows.some((entry) => entry.path.endsWith(".node") && !entry.path.includes("keyring-win32-x64-msvc"))).toBe(false);
  });

  it("builds the same bytes twice", async () => {
    const first = await build(await temp());
    const second = await build(await temp());
    expect(second.assets.map((asset) => asset.sha256)).toEqual(first.assets.map((asset) => asset.sha256));
  });

  it("refuses an unknown platform, a bad version and an addon that fails its integrity check", async () => {
    const dir = await temp();
    const entry = join(dir, "main.js");
    await writeFile(entry, "1;\n");
    await expect(buildRelease({ entry, packageDir, outDir: dir, version: "9.9.9", platforms: ["plan9-x64"] })).rejects.toThrow("Unknown platform");
    await expect(buildRelease({ entry, packageDir, outDir: dir, version: "latest", platforms: ["linux-x64"] })).rejects.toThrow("Invalid release version");
    await expect(build(await temp(), registry({ "@napi-rs/keyring-win32-x64-msvc": { "a.node": "x" } }, { wrongIntegrity: true }))).rejects.toThrow("integrity");
  });
});
