import { PluginSetupError, type HarnessClient } from "./generate.js";

export interface ClientCompatibility {
  target: HarnessClient;
  testedVersion: string | null;
  status: "tested" | "unverified";
}

/** Exact native-client versions probed for this release; a generated manifest alone is not support evidence. */
export const CLIENT_COMPATIBILITY: Record<HarnessClient, ClientCompatibility> = {
  claude: { target: "claude", testedVersion: "2.1.278", status: "tested" },
  codex: { target: "codex", testedVersion: "0.163.0-alpha.10.2", status: "tested" },
  copilot: { target: "copilot", testedVersion: null, status: "unverified" },
};

export function assertClientCompatibility(target: HarnessClient, version: string): void {
  const supported = CLIENT_COMPATIBILITY[target];
  if (supported.testedVersion === null) {
    throw new PluginSetupError("CLIENT_VERSION_UNVERIFIED", `Native setup for ${target} is not enabled until an exact client version is tested`);
  }
  if (version !== supported.testedVersion) {
    throw new PluginSetupError("CLIENT_VERSION_UNSUPPORTED", `${target} version ${version} is untested; the verified version is ${supported.testedVersion}`);
  }
}
