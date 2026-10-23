// Port of the release store. The adapter reads what the image was built with.

import type { ReleaseManifest } from "./release.js";

export abstract class ReleaseStore {
  /** The manifest of the highest version, when any release is present. */
  abstract latest(): Promise<ReleaseManifest | undefined>;
  abstract find(version: string): Promise<ReleaseManifest | undefined>;
  /** The absolute path of a file the manifest of `version` lists; undefined for anything else. */
  abstract assetPath(version: string, file: string): Promise<string | undefined>;
}
