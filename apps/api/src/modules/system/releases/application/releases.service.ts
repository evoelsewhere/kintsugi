// Use cases of CLI releases: describe the latest one, render its installers, and resolve a package to download.

import { Injectable, NotFoundException } from "@nestjs/common";
import { loadEnv } from "#common/config/env.js";
import type { ReleaseAsset, ReleaseManifest } from "../domain/release.js";
import { ReleaseStore } from "../domain/release.store.js";
import { renderInstallPs1, renderInstallSh } from "./install-scripts.js";

/** A release as the Guideline and the installers see it: with the installation's URL and where each package is. */
export interface ReleaseView extends ReleaseManifest {
  baseUrl: string;
  assets: Array<ReleaseAsset & { url: string }>;
  installers: { sh: string; ps1: string };
}

@Injectable()
export class ReleasesService {
  readonly #baseUrl = loadEnv().publicUrl;

  constructor(private readonly store: ReleaseStore) {}

  async latest(): Promise<ReleaseView> {
    const manifest = await this.#latestManifest();
    const base = `${this.#baseUrl}/api/v1/releases`;
    return {
      ...manifest,
      baseUrl: this.#baseUrl,
      assets: manifest.assets.map((asset) => ({ ...asset, url: `${base}/${manifest.version}/${asset.file}` })),
      installers: { sh: `${base}/latest/install.sh`, ps1: `${base}/latest/install.ps1` },
    };
  }

  async installer(kind: "sh" | "ps1"): Promise<string> {
    const input = { baseUrl: this.#baseUrl, manifest: await this.#latestManifest() };
    return kind === "sh" ? renderInstallSh(input) : renderInstallPs1(input);
  }

  /** The path of a package of `version` (`latest` for the highest); the file must be one its manifest lists. */
  async asset(version: string, file: string): Promise<{ path: string; file: string }> {
    const resolved = version === "latest" ? (await this.#latestManifest()).version : version;
    const path = await this.store.assetPath(resolved, file);
    if (path === undefined) throw new NotFoundException("No such CLI package");
    return { path, file };
  }

  async #latestManifest(): Promise<ReleaseManifest> {
    const manifest = await this.store.latest();
    if (manifest === undefined) throw new NotFoundException("This installation has no CLI release; it is built with the image (pnpm release:cli)");
    return manifest;
  }
}
