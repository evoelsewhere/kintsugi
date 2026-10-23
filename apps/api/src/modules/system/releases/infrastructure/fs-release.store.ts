// Release store over a folder: `<dir>/<version>/manifest.json` and the archives it lists.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { compareVersions, SEMVER, type ReleaseManifest } from "../domain/release.js";
import { ReleaseStore } from "../domain/release.store.js";

const manifestSchema = z.object({
  schemaVersion: z.literal("1"),
  version: z.string().regex(SEMVER),
  builtAt: z.string(),
  minNode: z.string().regex(/^\d+\.\d+\.\d+$/),
  assets: z.array(z.object({
    platform: z.string().regex(/^[a-z0-9]+-[a-z0-9]+$/),
    file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
  })),
});

@Injectable()
export class FsReleaseStore extends ReleaseStore {
  readonly #dir = resolve(process.env["KINTSUGI_RELEASES_DIR"] ?? "releases");

  async latest(): Promise<ReleaseManifest | undefined> {
    let names: string[];
    try { names = await readdir(this.#dir); } catch { return undefined; }
    const manifests: ReleaseManifest[] = [];
    for (const name of names.filter((entry) => SEMVER.test(entry))) {
      const manifest = await this.find(name);
      if (manifest !== undefined) manifests.push(manifest);
    }
    return manifests.sort((a, b) => compareVersions(b.version, a.version))[0];
  }

  async find(version: string): Promise<ReleaseManifest | undefined> {
    if (!SEMVER.test(version)) return undefined;
    try {
      const parsed = manifestSchema.safeParse(JSON.parse(await readFile(join(this.#dir, version, "manifest.json"), "utf8")));
      return parsed.success && parsed.data.version === version ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  async assetPath(version: string, file: string): Promise<string | undefined> {
    const manifest = await this.find(version);
    if (manifest?.assets.find((asset) => asset.file === file) === undefined) return undefined;
    const path = join(this.#dir, version, file);
    return (await stat(path).catch(() => undefined))?.isFile() === true ? path : undefined;
  }
}
