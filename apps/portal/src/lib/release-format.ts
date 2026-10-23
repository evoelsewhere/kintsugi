// What the Guideline shows of a release: types and pure helpers (no API access).

export interface ReleaseAsset {
  /** `<os>-<arch>`: linux-x64, darwin-arm64, win32-x64, ... */
  platform: string;
  file: string;
  sha256: string;
  size: number;
  url: string;
}

export interface Release {
  version: string;
  builtAt: string;
  minNode: string;
  /** The installation's URL, for the install commands. */
  baseUrl: string;
  assets: ReleaseAsset[];
  installers: { sh: string; ps1: string };
}

const NAMES: Record<string, string> = {
  "linux-x64": "Linux (x64)",
  "linux-arm64": "Linux (ARM64)",
  "darwin-x64": "macOS (Intel)",
  "darwin-arm64": "macOS (Apple silicon)",
  "win32-x64": "Windows (x64)",
  "win32-arm64": "Windows (ARM64)",
};

export const platformName = (platform: string): string => NAMES[platform] ?? platform;

/** The one-line commands the Guideline shows. */
export function installCommands(release: Release): { sh: string; ps1: string } {
  return {
    sh: `curl -fsSL ${release.installers.sh} | sh`,
    ps1: `powershell -ExecutionPolicy Bypass -Command "irm ${release.installers.ps1} | iex"`,
  };
}
