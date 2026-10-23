// Typed access to the CLI release (Guideline, ADR-0070). The route is public because the installers are fetched by curl.
// Mirrors apps/api → modules/system/releases.

import { apiGet } from "../api";

import type { Release } from "../release-format";

export { installCommands, platformName } from "../release-format";
export type { Release, ReleaseAsset } from "../release-format";

export const releasesApi = {
  latest: () => apiGet<Release>("/api/v1/releases/latest"),
};
