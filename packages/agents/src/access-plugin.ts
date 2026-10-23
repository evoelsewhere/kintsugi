import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ACCESS_PLUGIN_DIR = fileURLToPath(new URL("../builtin/plugins/access/", import.meta.url));

export const ACCESS_PLUGIN_SOURCE_PATHS = [
  ".claude-plugin/plugin.json",
  "kintsugi.json",
  "skills/kintsugi-task/SKILL.md",
  "assets/kintsugi-mark-light.svg",
  "assets/kintsugi-mark-dark.svg",
] as const;

export type AccessPluginSourcePath = (typeof ACCESS_PLUGIN_SOURCE_PATHS)[number];

/** Reads only the canonical, reviewed access-plugin files shipped with this package. */
export function readAccessPluginSources(): Record<AccessPluginSourcePath, string> {
  return Object.fromEntries(
    ACCESS_PLUGIN_SOURCE_PATHS.map((path) => [path, readFileSync(join(ACCESS_PLUGIN_DIR, path), "utf8")]),
  ) as Record<AccessPluginSourcePath, string>;
}
