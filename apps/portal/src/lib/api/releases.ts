// Typed access to the CLI release (Guideline, ADR-0070). The route is public because the installers are fetched by curl.
// Mirrors apps/api → modules/system/releases.

import { ApiError, apiGet } from "../api";

import type { Release } from "../release-format";

export { installCommands, platformName } from "../release-format";
export type { Release, ReleaseAsset } from "../release-format";

export const releasesApi = {
  /** The latest release, or null when this installation has none yet (the API answers 404). */
  latest: async (): Promise<Release | null> => {
    try {
      return await apiGet<Release>("/api/v1/releases/latest");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && !error.unreachable) return null;
      throw error;
    }
  },
};
