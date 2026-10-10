// Path confinement for kernel tools. pi's file tools accept absolute paths and `..`;
// every path is resolved (symlinks included) and must stay under one of the allowed
// roots. This is defence in depth: the sandbox (ADR-0004) is the isolation boundary.

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** True when `path` is `root` or inside it. Both must be absolute and normalized. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolves symlinks of the longest existing prefix, so not-yet-created paths can be checked too. */
export function realPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return resolve(realPath(parent), relative(parent, absolute));
  }
}

export class PathGuard {
  readonly #roots: string[];

  constructor(roots: readonly string[]) {
    this.#roots = roots.map(realPath);
  }

  /** Returns the real path, or throws when it escapes every root. */
  check(path: string): string {
    const real = realPath(path);
    if (!this.#roots.some((root) => isInside(root, real))) {
      throw new Error(`path is outside the job workspace: ${path}`);
    }
    return real;
  }
}
