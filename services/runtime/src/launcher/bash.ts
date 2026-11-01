// The bash the kernel's `shell` tool runs (T2-010), without pi: the launcher looks it up in the worker and hands the
// answer to an agent child, whose permission model keeps it out of the PATH folders.

import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

/**
 * The bash the `shell` tool runs, or undefined when there is none (T2-010): on Windows, Git for Windows' bash next to the
 * `git` on the PATH (Git puts only its `cmd` folder there, not `bin`), else a bash on the PATH. Without one, `shell` is
 * not offered to the job (`withAvailableShell`), so a model does not spend turns on a tool that always fails.
 */
export function findBash(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, check: (path: string) => boolean = existsSync): string | undefined {
  const path = platform === "win32" ? win32 : posix;
  // Under Node's permission model a folder outside the allowed ones throws instead of answering: it holds no bash we may use.
  const exists = (file: string): boolean => {
    try {
      return check(file);
    } catch {
      return false;
    }
  };
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(path.delimiter).filter((dir) => dir !== "");
  if (platform === "win32") {
    for (const dir of dirs) {
      if (!exists(path.join(dir, "git.exe"))) continue;
      const root = path.dirname(dir);
      for (const candidate of [path.join(root, "bin", "bash.exe"), path.join(root, "usr", "bin", "bash.exe")]) if (exists(candidate)) return candidate;
    }
  }
  const name = platform === "win32" ? "bash.exe" : "bash";
  for (const dir of dirs) if (exists(path.join(dir, name))) return path.join(dir, name);
  return undefined;
}

/**
 * The variable the launcher sets in an agent child's environment to the bash it found ("" for none): the child runs under
 * Node's permission model and cannot look through the PATH folders itself.
 */
export const BASH_ENV = "KINTSUGI_BASH";

let bash: { path: string | undefined } | undefined;

/** The bash of this process, looked up once: the launcher's answer in an agent child, else `findBash`. */
export function bashCommand(): string | undefined {
  const given = process.env[BASH_ENV];
  bash ??= { path: given !== undefined ? given || undefined : findBash(process.env, process.platform) };
  return bash.path;
}
