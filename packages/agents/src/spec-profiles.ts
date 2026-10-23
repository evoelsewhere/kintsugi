// The built-in specification profiles (ADR-0060): the versions of the files under
// builtin/plugins/reverse_engineering/skills/understand-planning/references/spec-profiles/, by item kind.
// The `understand` stage records `profile: <kind>@<version>` in an item's understanding record; the catalog
// compares it with these (and a project's own) to tell that a specification predates a newer profile.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_DIR } from "./builtin.js";

const PROFILE_DIR = join(BUILTIN_DIR, "plugins", "reverse_engineering", "skills", "understand-planning", "references", "spec-profiles");

/** The version of a profile document whose front matter names `kind`; undefined when it is not a usable profile. */
export function profileVersionOf(text: string, kind: string): number | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (front === undefined) return undefined;
  const named = /^kind:\s*"?([a-z0-9][a-z0-9-]{0,62})"?\s*$/m.exec(front)?.[1];
  const version = /^version:\s*(\d{1,6})\s*$/m.exec(front)?.[1];
  return named === kind && version !== undefined && Number(version) >= 1 ? Number(version) : undefined;
}

/** The built-in profile versions by item kind. */
export function builtinSpecProfileVersions(dir: string = PROFILE_DIR): Map<string, number> {
  const versions = new Map<string, number>();
  if (!existsSync(dir)) return versions;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const kind = name.slice(0, -3);
    const version = profileVersionOf(readFileSync(join(dir, name), "utf8"), kind);
    if (version !== undefined) versions.set(kind, version);
  }
  return versions;
}
