// Builds the CLI packages of a release: `node dist/release/main.js [--out <dir>] [--platforms a,b]`.
// Needs the registry (the keyring addons of Windows and macOS) unless --platforms names Linux only.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease } from "./build.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const versionSource = await readFile(join(packageDir, "src", "version.ts"), "utf8");
const version = /KINTSUGI_CLI_VERSION\s*=\s*"([^"]+)"/.exec(versionSource)?.[1];
if (version === undefined) throw new Error("Could not read KINTSUGI_CLI_VERSION from src/version.ts");

const platforms = option("platforms")?.split(",").map((id) => id.trim()).filter(Boolean);
const manifest = await buildRelease({
  entry: join(packageDir, "dist", "main.js"),
  packageDir,
  outDir: resolve(option("out") ?? "releases"),
  version,
  ...(platforms === undefined ? {} : { platforms }),
  log: (line) => process.stderr.write(`${line}\n`),
});
process.stdout.write(`Built Kintsugi CLI ${manifest.version} for ${manifest.assets.map((asset) => asset.platform).join(", ")}\n`);
