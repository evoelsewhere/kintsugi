// Domain of CLI releases (ADR-0070): the packages the installation serves for members to install the Kintsugi CLI,
// built with the image (packages/cli/src/release) and described by a manifest. Pure types and ordering.

export interface ReleaseAsset {
  /** `<os>-<arch>` as Node reports them: linux-x64, darwin-arm64, win32-x64, ... */
  platform: string;
  file: string;
  /** Lowercase hex SHA-256 of the file. */
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  schemaVersion: "1";
  version: string;
  builtAt: string;
  /** Lowest Node.js the package runs on. */
  minNode: string;
  assets: ReleaseAsset[];
}

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Orders two versions: numeric parts first, a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): { numbers: number[]; pre: string } => {
    const [core = "", ...rest] = value.split("-");
    return { numbers: core.split(".").map(Number), pre: rest.join("-") };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === "") return 1;
  if (right.pre === "") return -1;
  return left.pre < right.pre ? -1 : 1;
}
