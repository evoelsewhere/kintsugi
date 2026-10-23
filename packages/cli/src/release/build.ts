// Builds the downloadable CLI packages of a release (ADR-0070): one .tar.gz per platform and a manifest with their
// SHA-256. The CLI is bundled into one file; zod stays a package beside it (its module graph does not survive
// bundling), and Windows and macOS carry the native keyring addon of their platform. Node.js is the one thing the
// package does not carry: the installers check for it.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { build } from "esbuild";
import { type Fetch, fetchPackageFiles } from "./registry.js";
import { type TarEntry, createTarGz } from "./tar.js";

export const MIN_NODE = "22.19.0";

export interface ReleasePlatform {
  /** `<os>-<arch>` as Node reports them. */
  id: string;
  os: "linux" | "darwin" | "win32";
  arch: "x64" | "arm64";
  /** The npm package with the native keyring addon, when the platform uses it (Linux uses Secret Service directly). */
  addon?: string;
}

export const PLATFORMS: readonly ReleasePlatform[] = [
  { id: "linux-x64", os: "linux", arch: "x64" },
  { id: "linux-arm64", os: "linux", arch: "arm64" },
  { id: "darwin-x64", os: "darwin", arch: "x64", addon: "@napi-rs/keyring-darwin-x64" },
  { id: "darwin-arm64", os: "darwin", arch: "arm64", addon: "@napi-rs/keyring-darwin-arm64" },
  { id: "win32-x64", os: "win32", arch: "x64", addon: "@napi-rs/keyring-win32-x64-msvc" },
  { id: "win32-arm64", os: "win32", arch: "arm64", addon: "@napi-rs/keyring-win32-arm64-msvc" },
];

export interface ReleaseAsset {
  platform: string;
  file: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  schemaVersion: "1";
  version: string;
  builtAt: string;
  minNode: string;
  assets: ReleaseAsset[];
}

export interface BuildOptions {
  /** Entry of the compiled CLI (packages/cli/dist/main.js). */
  entry: string;
  /** The CLI package folder; its node_modules supply zod and the keyring package. */
  packageDir: string;
  /** Receives `<outDir>/<version>/`. */
  outDir: string;
  version: string;
  platforms?: readonly string[];
  fetch?: Fetch;
  now?: Date;
  log?: (line: string) => void;
}

const LAUNCHER_SH = `#!/bin/sh
# Starts the Kintsugi CLI with the Node.js found on PATH.
dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$dir/lib/kintsugi.mjs" "$@"
`;

const LAUNCHER_CMD = "@echo off\r\nnode \"%~dp0..\\lib\\kintsugi.mjs\" %*\r\n";

/** Files of a package that Node does not load when it is imported. */
const UNUSED = /\.(?:d\.ts|d\.cts|d\.mts|cjs|map)$/;

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function packageEntries(packageDir: string, target: string, keep: (path: string) => boolean = () => true): Promise<TarEntry[]> {
  const root = await realpath(packageDir);
  const entries: TarEntry[] = [];
  for (const file of (await walk(root)).sort()) {
    const path = relative(root, file).split(sep).join("/");
    if (path.startsWith("node_modules/") || !keep(path)) continue;
    entries.push({ path: `${target}/${path}`, data: await readFile(file) });
  }
  return entries;
}

function resolvePackageDir(from: string, name: string): string {
  return dirname(createRequire(join(from, "package.json")).resolve(`${name}/package.json`));
}

export async function bundleCli(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    // esbuild writes each module's path as a comment; relative to the entry's folder they do not depend on where the build runs.
    absWorkingDir: dirname(entry),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    legalComments: "none",
    logLevel: "silent",
    // zod's module graph is circular and breaks when bundled; the keyring addon is native.
    external: ["zod", "@napi-rs/keyring"],
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error("esbuild produced no output");
  return output.text;
}

export async function buildRelease(options: BuildOptions): Promise<ReleaseManifest> {
  const log = options.log ?? (() => undefined);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) throw new Error(`Invalid release version: ${options.version}`);
  const chosen = PLATFORMS.filter((platform) => options.platforms === undefined || options.platforms.includes(platform.id));
  const unknown = (options.platforms ?? []).filter((id) => !PLATFORMS.some((platform) => platform.id === id));
  if (unknown.length > 0) throw new Error(`Unknown platform: ${unknown.join(", ")}`);
  if (chosen.length === 0) throw new Error("No platform to build");

  const bundle = await bundleCli(options.entry);
  log(`bundled the CLI (${(bundle.length / 1024).toFixed(0)} KiB)`);
  const zodDir = resolvePackageDir(options.packageDir, "zod");
  const keyringDir = resolvePackageDir(options.packageDir, "@napi-rs/keyring");
  const keyring = JSON.parse(await readFile(join(keyringDir, "package.json"), "utf8")) as { version: string };
  const zod = await packageEntries(zodDir, "kintsugi/node_modules/zod", (path) => !UNUSED.test(path));
  const keyringBase = await packageEntries(keyringDir, "kintsugi/node_modules/@napi-rs/keyring", (path) => !path.endsWith(".d.ts") && !path.endsWith(".node"));

  const releaseDir = join(options.outDir, options.version);
  await mkdir(releaseDir, { recursive: true });
  const assets: ReleaseAsset[] = [];
  for (const platform of chosen) {
    const entries: TarEntry[] = [
      { path: "kintsugi/bin/kintsugi", data: Buffer.from(LAUNCHER_SH), mode: 0o755 },
      { path: "kintsugi/bin/kintsugi.cmd", data: Buffer.from(LAUNCHER_CMD) },
      { path: "kintsugi/lib/kintsugi.mjs", data: Buffer.from(bundle) },
      { path: "kintsugi/package.json", data: Buffer.from(`${JSON.stringify({ name: "kintsugi-cli", version: options.version, private: true, type: "module" }, null, 2)}\n`) },
      { path: "kintsugi/VERSION", data: Buffer.from(`${options.version}\n`) },
      ...zod,
    ];
    if (platform.addon !== undefined) {
      log(`fetching ${platform.addon}@${keyring.version}`);
      const addon = await fetchPackageFiles(platform.addon, keyring.version, fetcher);
      entries.push(...keyringBase);
      for (const [path, data] of addon) entries.push({ path: `kintsugi/node_modules/${platform.addon}/${path}`, data });
    }
    const archive = createTarGz(entries);
    const file = `kintsugi-${options.version}-${platform.id}.tar.gz`;
    await writeFile(join(releaseDir, file), archive);
    assets.push({ platform: platform.id, file, sha256: createHash("sha256").update(archive).digest("hex"), size: archive.length });
    log(`${file} ${(archive.length / 1024 / 1024).toFixed(1)} MiB`);
  }

  const manifest: ReleaseManifest = { schemaVersion: "1", version: options.version, builtAt: (options.now ?? new Date()).toISOString(), minNode: MIN_NODE, assets };
  await writeFile(join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
