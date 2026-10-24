import { PluginSetupError, type HarnessClient } from "./generate.js";

export interface ClientCompatibility {
  target: HarnessClient;
  testedVersion: string | null;
  status: "tested" | "unverified";
}

/** The native-client versions probed for this release; a generated manifest alone is not support evidence. */
export const CLIENT_COMPATIBILITY: Record<HarnessClient, ClientCompatibility> = {
  claude: { target: "claude", testedVersion: "2.1.278", status: "tested" },
  codex: { target: "codex", testedVersion: "0.163.0-alpha.10.2", status: "tested" },
  copilot: { target: "copilot", testedVersion: "1.0.63", status: "tested" },
};

/**
 * Whether a client version is the one this release was probed with. Clients update every few weeks, so another version is not
 * refused (ADR-0072): setup goes ahead and reports `untested`, and the commands it runs are the plain plugin commands that
 * every recent version has. A client that was never probed at all (Copilot) stays disabled.
 */
export function clientVersionStatus(target: HarnessClient, version: string): "tested" | "untested" {
  const supported = CLIENT_COMPATIBILITY[target];
  if (supported.testedVersion === null) {
    throw new PluginSetupError("CLIENT_VERSION_UNVERIFIED", `Native setup for ${target} is not enabled until a client version is tested`);
  }
  return version === supported.testedVersion ? "tested" : "untested";
}

export function assertClientCompatibility(target: HarnessClient, version: string): void {
  clientVersionStatus(target, version);
}

/** `0.163.0-alpha.10.2` → [0, 163, 0]; undefined when the text holds no version. */
export function versionParts(version: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `version` is `minimum` or later, by major, minor and patch (a pre-release suffix is ignored). */
export function versionAtLeast(version: string, minimum: string): boolean {
  const have = versionParts(version);
  const need = versionParts(minimum);
  if (have === undefined || need === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    if (have[index]! !== need[index]!) return have[index]! > need[index]!;
  }
  return true;
}
