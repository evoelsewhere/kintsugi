// Fetches a package from the npm registry at build time and checks it against the registry's own integrity hash.
// The native keyring addons of Windows and macOS are not in the workspace (pnpm installs only the host's), so a
// release for another platform takes its addon from here.

import { createHash } from "node:crypto";
import { readTarGz } from "./tar.js";

export type Fetch = typeof globalThis.fetch;

interface VersionDocument {
  dist?: { tarball?: string; integrity?: string };
}

/** The files of `<name>@<version>` keyed by path inside the package (no `package/` prefix). */
export async function fetchPackageFiles(name: string, version: string, fetcher: Fetch = globalThis.fetch, registry = "https://registry.npmjs.org"): Promise<Map<string, Buffer>> {
  const metadata = await fetcher(`${registry}/${name.replace("/", "%2F")}/${version}`, { headers: { accept: "application/json" } });
  if (!metadata.ok) throw new Error(`The registry has no ${name}@${version} (HTTP ${metadata.status})`);
  const document = await metadata.json() as VersionDocument;
  const tarball = document.dist?.tarball;
  const integrity = document.dist?.integrity;
  if (tarball === undefined || integrity === undefined || !integrity.startsWith("sha512-")) throw new Error(`The registry gave no sha512 integrity for ${name}@${version}`);
  const response = await fetcher(tarball);
  if (!response.ok) throw new Error(`Could not download ${tarball} (HTTP ${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  if (`sha512-${createHash("sha512").update(body).digest("base64")}` !== integrity) throw new Error(`${name}@${version} does not match its registry integrity hash`);
  const files = new Map<string, Buffer>();
  for (const entry of readTarGz(body)) files.set(entry.path.replace(/^package\//, ""), entry.data);
  return files;
}
