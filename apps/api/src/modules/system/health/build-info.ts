import { createRequire } from "node:module";

/** What is deployed: the package version plus the commit and build time the CI stamps into the image. */
export interface BuildInfo {
  version: string;
  commit: string;
  commitShort: string;
  builtAt: string | null;
  startedAt: string;
}

const UNKNOWN = "unknown";

function packageVersion(): string {
  try {
    return (createRequire(import.meta.url)("../../../../package.json") as { version?: string }).version ?? UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/** KINTSUGI_BUILD_COMMIT / KINTSUGI_BUILD_TIME come from the image build args (Dockerfile.app); local runs report "unknown". */
export function readBuildInfo(env: NodeJS.ProcessEnv = process.env, startedAt: Date = new Date()): BuildInfo {
  const commit = env.KINTSUGI_BUILD_COMMIT?.trim() || UNKNOWN;
  return {
    version: packageVersion(),
    commit,
    commitShort: commit === UNKNOWN ? UNKNOWN : commit.slice(0, 7),
    builtAt: env.KINTSUGI_BUILD_TIME?.trim() || null,
    startedAt: startedAt.toISOString(),
  };
}
