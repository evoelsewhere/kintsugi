// The kernel `git` tool (ADR-0040): git subcommands as an explicit argument list — no shell, no
// alias expansion (the first argument must be a real git command), and no option that redirects
// the repository, loads extra configuration or starts an external helper. Read-only subcommands
// run anywhere in the job workspace; every other subcommand runs only where the job may write
// (the output directory or the scratch), because a mutating command must not touch a checkout
// the job only reads — clone or init the repository there first. The environment is the job's
// cleared one plus git hardening: no system or global configuration, no prompts, no pager,
// neutral commit identity, hooks and fsmonitor pointed at nothing, and only network protocols
// that cannot start a command. The subcommands that render diffs or blame run with the
// repository's external diff drivers and converters switched off (they are commands).

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../launcher/process.js";
import { jobEnvironment } from "../launcher/script.js";
import { boundOutput } from "./output.js";
import type { PathGuard } from "./paths.js";

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 600;

/** Subcommands that never change the repository or the working tree. */
const READ_ONLY_SUBCOMMANDS = new Set([
  "blame", "cat-file", "cherry", "count-objects", "describe", "diff", "grep", "log", "ls-files",
  "ls-tree", "merge-base", "name-rev", "range-diff", "rev-parse", "shortlog", "show", "show-ref",
  "status", "version", "whatchanged",
]);

/** Everything the tool accepts. The first argument must be one of these: git would otherwise
 * expand a repository-configured alias — including `alias.x '!command'` — for unknown names. */
const ALL_SUBCOMMANDS = new Set([
  ...READ_ONLY_SUBCOMMANDS,
  "add", "am", "apply", "branch", "checkout", "cherry-pick", "clean", "clone", "commit", "config",
  "fetch", "gc", "init", "merge", "mv", "pull", "push", "rebase", "reflog", "remote", "reset",
  "restore", "revert", "rm", "stash", "submodule", "switch", "tag", "worktree",
]);

/** Options that would take the tool outside its boundary: redirect the repository, load extra
 * configuration (`--config`, `-c`), write files (`--output`) or start an external helper
 * (`--upload-pack`, `-u` on clone, `--exec`, `--ext-diff`, `--textconv`). */
const FORBIDDEN_OPTIONS = [
  "-c", "-C", "-u",
  "--git-dir", "--work-tree", "--exec-path", "--namespace", "--config-env", "--config",
  "--upload-pack", "--receive-pack", "--ext-diff", "--textconv", "--output", "--exec",
  // Another repository or a template from anywhere on disk, a git directory outside, a command that opens files (T3-003).
  "--reference", "--reference-if-able", "--separate-git-dir", "--template", "--open-files-in-pager",
  // Submodules whose URLs the repository names (anywhere on disk, or a transport of its choosing); a file read from
  // anywhere into a blame (`--contents`) or a message (`commit`, `tag`, `merge` `--file`); a patch that writes outside
  // the working tree (`apply --unsafe-paths`) (P-004).
  "--recurse-submodules", "--contents", "--unsafe-paths",
];

/** Subcommands whose `--file` (`-F`, see below) reads a message from a file anywhere on disk (P-004). */
const MESSAGE_FILE_SUBCOMMANDS = new Set(["commit", "tag", "merge"]);

/**
 * Short options that start a command, by subcommand. git also takes them bundled (`-qu <cmd>`) or with the value
 * attached (`-u<cmd>`), so any single-dash argument that holds the letter before a value starts is refused. Long
 * options cannot be abbreviated (`--upload=<cmd>`): the environment tells git to refuse abbreviations.
 */
const COMMAND_SHORT_OPTIONS: Readonly<Record<string, string>> = { clone: "u", rebase: "x", grep: "O", commit: "F", tag: "F", merge: "F" };

/** `git config` only reads: one of these forms, and no file of its own choosing. */
const CONFIG_READS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "get", "list"]);
const CONFIG_REFUSED = new Set([
  "--add", "--unset", "--unset-all", "--replace-all", "--rename-section", "--remove-section", "--edit", "-e",
  "set", "unset", "rename-section", "remove-section", "edit", "--file", "--blob",
]);

/** Options of clone whose value is the next argument, so it is not taken for the source or the target. */
const CLONE_VALUE_OPTIONS = new Set(["--depth", "--branch", "-b", "--origin", "-o", "--jobs", "-j", "--filter", "--shallow-since", "--shallow-exclude", "--bundle-uri", "--server-option", "--revision"]);

/** Subcommands that accept `--no-ext-diff` and `--no-textconv`, to keep repository-configured diff drivers and
 * converters (which are commands) out of diff rendering. An empty GIT_EXTERNAL_DIFF or `diff.external` does not
 * switch them off: git takes it as an external diff command named "" and every patch fails (T3-002). */
const TEXTCONV_SUBCOMMANDS = new Set(["diff", "log", "show", "whatchanged"]);

/** Subcommands that run a converter but take no `--no-ext-diff`: they get `--no-textconv` alone (P-004). */
const TEXTCONV_ONLY_SUBCOMMANDS = new Set(["blame"]);

const parameters = Type.Object({
  args: Type.Array(Type.String(), {
    description: 'Git arguments starting with the subcommand, e.g. ["log", "--oneline", "-5"].',
  }),
  cwd: Type.Optional(Type.String({
    description: "Directory to run git in (default: the workspace root). Mutating subcommands require a directory under the job's writable area.",
  })),
  timeout: Type.Optional(Type.Number({ description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC}).` })),
});

function clampTimeoutSec(timeout: number | undefined): number {
  if (timeout === undefined || Number.isNaN(timeout)) return DEFAULT_TIMEOUT_SEC;
  return Math.min(Math.max(Math.round(timeout), 1), MAX_TIMEOUT_SEC);
}

/**
 * `git diff` with a path outside the repository (or run outside one) compares the two paths as files anywhere on disk,
 * as `--no-index` does: every argument that is not an option must stay in the workspace. A revision resolves to a
 * path inside the directory, so it passes.
 */
function checkDiffPaths(args: readonly string[], dir: string, guard: PathGuard): void {
  let paths = false;
  for (const arg of args) {
    if (!paths && arg === "--") paths = true;
    else if (paths || !arg.startsWith("-")) guard.check(resolve(dir, arg));
  }
}

function findForbiddenOption(subcommand: string, args: readonly string[]): string | undefined {
  const short = COMMAND_SHORT_OPTIONS[subcommand];
  for (const arg of args) {
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (FORBIDDEN_OPTIONS.includes(name) || (name === "--file" && MESSAGE_FILE_SUBCOMMANDS.has(subcommand))) return arg;
    if (short === undefined || !/^-[^-]/.test(arg)) continue;
    for (const letter of arg.slice(1)) {
      if (letter === short) return arg;
      if (!/[A-Za-z]/.test(letter)) break;
    }
  }
  return undefined;
}

/*
 * The options each subcommand accepts (P-031): every other one is refused, so an option git adds, or one nobody thought
 * of, cannot read or write outside the workspace; the blocklist above stays as a second line. An entry ending in "="
 * takes a value: after "=" (long), attached (short) or as the next argument. In real use: the code-reviewer reads a
 * merge request with diff, log, show and blame; no prompt, workflow or script of the built-in plugins tells an agent to
 * run any other git command (the plugin scripts call git themselves, outside this tool).
 */
const DIFF_OPTIONS = [
  "-p", "--patch", "-s", "--no-patch", "-U=", "--unified=", "--stat", "--stat=", "--shortstat", "--numstat", "--name-only", "--name-status",
  "--summary", "--raw", "--no-color", "--color=", "--word-diff", "--word-diff=", "--color-words", "-w", "--ignore-all-space", "-b",
  "--ignore-space-change", "--ignore-blank-lines", "--ignore-cr-at-eol", "-M", "--find-renames", "--find-renames=", "--no-renames",
  "--diff-filter=", "--relative", "--relative=", "-R", "--minimal", "--patience", "--histogram", "--abbrev", "--abbrev=", "--full-index",
  "--binary", "-z", "--exit-code", "--quiet", "--check", "-a", "--text", "--function-context", "-W", "-S=", "-G=", "--pickaxe-all",
  "--no-ext-diff", "--no-textconv",
];
const LOG_OPTIONS = [
  ...DIFF_OPTIONS, "--oneline", "--format=", "--pretty", "--pretty=", "--graph", "--decorate", "--decorate=", "--no-decorate", "--all",
  "--branches", "--tags", "--remotes", "--reverse", "--follow", "--since=", "--until=", "--after=", "--before=", "--author=",
  "--committer=", "--grep=", "-i", "--regexp-ignore-case", "-E", "--extended-regexp", "-F", "--fixed-strings", "-n=", "--max-count=",
  "--skip=", "--no-merges", "--merges", "--first-parent", "--date=", "--abbrev-commit", "--no-abbrev-commit", "-L=", "--full-history",
  "--simplify-by-decoration", "--topo-order", "--date-order", "--author-date-order", "--left-right", "--cherry-pick", "--cherry-mark",
  "--boundary", "--ancestry-path", "--no-walk", "-m", "--cc", "-c", "--parents", "--children", "--source",
];

export const GIT_ALLOWED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  // Read-only subcommands.
  blame: ["-L=", "-w", "-M", "--porcelain", "--line-porcelain", "--incremental", "-e", "--show-email", "-s", "-l", "-t", "-f", "--show-name", "-n", "--show-number", "--root", "--reverse", "--date=", "--abbrev=", "--first-parent", "--minimal", "--no-textconv"],
  "cat-file": ["-t", "-s", "-p", "-e"],
  cherry: ["-v", "--abbrev", "--abbrev="],
  "count-objects": ["-v", "--verbose", "-H", "--human-readable"],
  describe: ["--tags", "--all", "--always", "--long", "--abbrev=", "--contains", "--exact-match", "--dirty", "--first-parent", "--candidates=", "--match=", "--exclude="],
  diff: [...DIFF_OPTIONS, "--cached", "--staged", "--merge-base"],
  grep: ["-n", "--line-number", "-i", "--ignore-case", "-w", "--word-regexp", "-v", "--invert-match", "-l", "--files-with-matches", "-L", "--files-without-match", "-c", "--count", "-e=", "-E", "--extended-regexp", "-F", "--fixed-strings", "-P", "--perl-regexp", "-G", "--basic-regexp", "-h", "-H", "--heading", "--break", "-A=", "-B=", "--context=", "--cached", "--untracked", "-o", "--only-matching", "-q", "--quiet", "--max-depth=", "--and", "--or", "--not", "-I", "--all-match", "--full-name", "-z", "--column", "--function-context", "-W"],
  log: LOG_OPTIONS,
  "ls-files": ["-c", "--cached", "-m", "--modified", "-o", "--others", "-d", "--deleted", "-s", "--stage", "--unmerged", "--exclude-standard", "-z", "--full-name", "--error-unmatch", "--directory", "--no-empty-directory", "-t", "--eol", "--deduplicate"],
  "ls-tree": ["-r", "-d", "-t", "-l", "--long", "--name-only", "--name-status", "--object-only", "--full-name", "--full-tree", "-z", "--abbrev", "--abbrev=", "--format="],
  "merge-base": ["--is-ancestor", "--all", "-a", "--octopus", "--fork-point", "--independent"],
  "name-rev": ["--name-only", "--tags", "--refs=", "--exclude=", "--all", "--always", "--no-undefined"],
  "range-diff": [...DIFF_OPTIONS, "--creation-factor=", "--no-dual-color", "--left-only", "--right-only"],
  "rev-parse": ["--verify", "-q", "--quiet", "--short", "--short=", "--abbrev-ref", "--abbrev-ref=", "--symbolic", "--symbolic-full-name", "--show-toplevel", "--show-prefix", "--show-cdup", "--is-inside-work-tree", "--is-bare-repository", "--is-shallow-repository", "--all", "--branches", "--tags", "--default="],
  shortlog: [...LOG_OPTIONS, "-s", "--summary", "-e", "--email", "--group="],
  show: LOG_OPTIONS,
  "show-ref": ["--heads", "--tags", "--head", "-s", "--hash", "--hash=", "--verify", "-q", "--quiet", "-d", "--dereference", "--abbrev", "--abbrev=", "--exists"],
  status: ["-s", "--short", "-b", "--branch", "--porcelain", "--porcelain=", "--long", "-v", "--verbose", "--untracked-files=", "--ignored", "--ignored=", "-z", "--ahead-behind", "--no-ahead-behind", "--renames", "--no-renames", "--show-stash"],
  version: ["--build-options"],
  whatchanged: [...LOG_OPTIONS, "--i-still-use-this"],
  // Mutating subcommands: they run only where the job may write.
  add: ["-A", "--all", "--update", "-N", "--intent-to-add", "-f", "--force", "-n", "--dry-run", "-v", "--verbose", "--ignore-errors", "--renormalize", "--chmod="],
  am: ["--abort", "--continue", "--skip", "--quit", "-3", "--3way", "-q", "--quiet", "-s", "--signoff", "--keep-cr", "--no-keep-cr"],
  apply: ["--check", "--stat", "--numstat", "--summary", "--cached", "--index", "-R", "--reverse", "-3", "--3way", "-p=", "--whitespace=", "--ignore-whitespace", "--ignore-space-change", "-v", "--verbose", "--recount", "--allow-empty"],
  branch: ["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--list", "-l", "-d", "-D", "--delete", "-m", "-M", "--move", "-c", "--copy", "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "-f", "--force", "--format=", "--sort=", "--points-at=", "-t", "--track", "--no-track"],
  checkout: ["-b=", "-B=", "--detach", "-f", "--force", "-q", "--quiet", "--orphan=", "--ours", "--theirs", "-m", "--merge", "--no-track", "-t", "--track"],
  "cherry-pick": ["-n", "--no-commit", "-x", "--abort", "--continue", "--skip", "--quit", "-m=", "--mainline=", "--ff", "--allow-empty", "--keep-redundant-commits", "-s", "--signoff", "-e", "--edit", "--no-edit"],
  clean: ["-n", "--dry-run", "-f", "--force", "-d", "-x", "-X", "-q", "--quiet", "-e="],
  clone: ["-q", "--quiet", "-v", "--verbose", "--origin=", "-o=", "--branch=", "-b=", "--depth=", "--single-branch", "--no-single-branch", "--no-checkout", "-n", "--bare", "--mirror", "--no-tags", "--filter=", "--shallow-since=", "--shallow-exclude=", "--no-hardlinks", "-l", "--local", "--sparse", "--jobs=", "-j=", "--revision="],
  commit: ["-m=", "--message=", "-q", "--quiet", "-a", "--all", "--amend", "--no-edit", "--allow-empty", "--allow-empty-message", "--author=", "--date=", "-s", "--signoff", "--no-verify", "--fixup=", "--squash=", "-v", "--verbose", "--dry-run", "--short", "--porcelain"],
  config: ["--get", "--get-all", "--get-regexp", "--list", "-l", "--local", "--null", "-z", "--name-only", "--show-origin", "--show-scope", "--type=", "--default=", "--bool", "--int", "--path"],
  fetch: ["-q", "--quiet", "-v", "--verbose", "--all", "--prune", "-p", "--tags", "-t", "--no-tags", "--depth=", "--deepen=", "--unshallow", "--shallow-since=", "--force", "-f", "--dry-run", "--atomic", "--filter=", "--no-recurse-submodules"],
  gc: ["--auto", "-q", "--quiet", "--prune=", "--aggressive"],
  init: ["-q", "--quiet", "--bare", "-b=", "--initial-branch=", "--object-format="],
  merge: ["--no-ff", "--ff", "--ff-only", "--squash", "--no-squash", "-m=", "--no-edit", "--abort", "--continue", "--quit", "-q", "--quiet", "-v", "--no-commit", "--commit", "-s=", "--strategy=", "-X=", "--strategy-option=", "--allow-unrelated-histories", "--stat", "--no-stat", "-n", "--log", "--no-log", "--signoff"],
  mv: ["-f", "--force", "-k", "-n", "--dry-run", "-v", "--verbose"],
  pull: ["-q", "--quiet", "-v", "--verbose", "--ff", "--ff-only", "--no-ff", "--rebase", "--rebase=", "--no-rebase", "--depth=", "--unshallow", "--tags", "--no-tags", "--prune", "-p", "--all", "--no-recurse-submodules"],
  push: ["--repo=", "-q", "--quiet", "-v", "--verbose", "-f", "--force", "--force-with-lease", "--force-with-lease=", "--set-upstream", "--tags", "--delete", "-d", "--all", "--dry-run", "-n", "--atomic", "--follow-tags", "--no-verify", "--porcelain", "--prune"],
  rebase: ["--onto=", "--abort", "--continue", "--skip", "--quit", "-q", "--quiet", "-v", "--root", "--autosquash", "--no-autosquash", "--keep-empty", "--empty=", "-f", "--force-rebase", "--committer-date-is-author-date", "--update-refs", "--no-update-refs", "-m", "--merge", "-s=", "--strategy=", "-X=", "--strategy-option=", "--autostash", "--no-autostash"],
  reflog: ["-n=", "--max-count=", "--date=", "--all", "--oneline", "--format=", "--pretty="],
  remote: ["-v", "--verbose", "-f", "--tags", "--no-tags", "-t=", "-m=", "--mirror=", "--push", "--add", "--delete", "--all", "-n", "--dry-run"],
  reset: ["--hard", "--soft", "--mixed", "--keep", "--merge", "-q", "--quiet", "-N", "--intent-to-add"],
  restore: ["--staged", "-S", "--worktree", "-W", "-s=", "--source=", "-q", "--quiet", "--ours", "--theirs", "-m", "--merge"],
  revert: ["-n", "--no-commit", "--abort", "--continue", "--skip", "--quit", "-m=", "--mainline=", "-e", "--edit", "--no-edit", "-s", "--signoff"],
  rm: ["-r", "-f", "--force", "--cached", "-q", "--quiet", "-n", "--dry-run", "--ignore-unmatch"],
  stash: ["-m=", "--message=", "--include-untracked", "-k", "--keep-index", "--no-keep-index", "-q", "--quiet", "-a", "--all", "--index", "--staged", "-S"],
  submodule: ["-q", "--quiet", "--init", "--depth=", "--cached", "--no-fetch", "-N", "--checkout", "--force", "-f"],
  switch: ["-c=", "--create=", "--force-create=", "--detach", "-d", "-f", "--force", "--discard-changes", "-q", "--quiet", "--orphan=", "-m", "--merge", "-t", "--track", "--no-track", "--guess", "--no-guess"],
  tag: ["-a", "--annotate", "-m=", "--message=", "-d", "--delete", "-l", "--list", "-f", "--force", "-n", "--sort=", "--contains", "--no-contains", "--points-at=", "--merged", "--no-merged", "--format=", "-v", "--verify"],
  worktree: ["-b=", "-B=", "--detach", "-d", "-f", "--force", "-q", "--quiet", "--lock", "--no-checkout", "--checkout", "--expire=", "-n", "--dry-run", "-v", "--verbose", "--porcelain", "-z"],
};

/** Why an option is refused, with the options the subcommand allows. */
function unlistedMessage(subcommand: string, option: string): string {
  const allowed = GIT_ALLOWED_OPTIONS[subcommand] ?? [];
  const name = option.split("=")[0]!;
  // git expands an unambiguous prefix of a long option; the tool never does (and the environment tells git not to).
  const abbreviated = name.startsWith("--") && [...FORBIDDEN_OPTIONS, ...allowed].some((known) => known.startsWith(name) && known.replace(/=$/, "") !== name);
  return (
    `git option "${option}" is not allowed for "git ${subcommand}" here${abbreviated ? " (abbreviated options are refused: write the option in full)" : ""}; ` +
    `allowed: ${allowed.map((entry) => entry.replace(/=$/, " <value>")).join(", ") || "none"}`
  );
}

/** Subcommands of the log family that take a commit count as `-<n>`. */
const COUNT_SHORTHAND = new Set(["log", "show", "whatchanged", "shortlog", "reflog"]);

/** The first option of `args` that is not on the subcommand's allowlist, or undefined (P-031). */
export function findUnlistedOption(subcommand: string, args: readonly string[]): string | undefined {
  const allowed = new Set(GIT_ALLOWED_OPTIONS[subcommand] ?? []);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") return undefined;
    if (!arg.startsWith("-") || arg === "-" || allowed.has(arg)) continue;
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      if (!allowed.has(`${name}=`)) return arg;
      if (equals === -1) index += 1;
      continue;
    }
    if (COUNT_SHORTHAND.has(subcommand) && /^-\d+$/.test(arg)) continue;
    // Short options, bundled (`-qa`): every letter must be allowed; one that takes a value ends the bundle.
    for (let at = 1; at < arg.length; at++) {
      const letter = `-${arg[at]}`;
      if (allowed.has(letter)) continue;
      if (!allowed.has(`${letter}=`)) return arg;
      if (at === arg.length - 1) index += 1;
      break;
    }
  }
  return undefined;
}

/** A clone source or remote given as a local path (or a file: URL), as the path; undefined for a network URL. */
function localPath(arg: string): string | undefined {
  if (/^file:/i.test(arg)) {
    try {
      return fileURLToPath(arg);
    } catch {
      return arg;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || /^[^/\\@]+@[^/\\]+:/.test(arg)) return undefined;
  return arg;
}

/**
 * The paths a subcommand makes or reads a repository at stay in the workspace (T3-003): what init and worktree make,
 * and the target of a clone, where the job may write; the source of a local clone, where it may read.
 */
function checkRepositoryPaths(subcommand: string, args: readonly string[], dir: string, guard: PathGuard, writeGuard: PathGuard): void {
  const outside = (path: string, where: string): Error => new Error(`git "${subcommand}" may not use ${path}: ${where}`);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (subcommand === "clone" && CLONE_VALUE_OPTIONS.has(arg)) index += 1;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  const writable = (path: string): void => {
    try {
      writeGuard.check(resolve(dir, path));
    } catch {
      throw outside(path, "a repository is made only in the job's writable area (the output directory or scratch)");
    }
  };
  if (subcommand === "init") positional.forEach(writable);
  // After the action (add, move, remove, ...): the worktree's path, and names that resolve inside the cwd.
  if (subcommand === "worktree") positional.slice(1).forEach(writable);
  if (subcommand === "clone") {
    const [source, ...targets] = positional;
    const local = source === undefined ? undefined : localPath(source);
    if (local !== undefined) {
      try {
        guard.check(resolve(dir, local));
      } catch {
        throw outside(source!, "a local repository is cloned only from inside the job workspace");
      }
    }
    targets.forEach(writable);
  }
}

/** Subcommands that move objects between repositories, and where a local repository they reach must be. */
const TRANSPORTS: Readonly<Record<string, "read" | "write">> = { fetch: "read", pull: "read", push: "write", remote: "read", submodule: "read" };

/**
 * A local repository that fetch, pull, push, remote or submodule reach stays in the workspace (T3-012): a path or `file:`
 * URL outside it would read another project's repositories or write refs into them (the worker's mirrors, other jobs).
 * A remote named by the command, or every remote when none is named, is read from the repository's configuration, and
 * for submodules the URLs of `.gitmodules` too. What push reaches must be writable; the rest readable.
 */
async function checkTransportPaths(subcommand: string, args: readonly string[], dir: string, env: Record<string, string>, guard: PathGuard, writeGuard: PathGuard): Promise<void> {
  const mode = TRANSPORTS[subcommand];
  if (mode === undefined) return;
  const configured = async (file?: string): Promise<{ key: string; url: string }[]> => {
    const result = await runProcess({ command: "git", args: ["config", ...(file === undefined ? [] : ["-f", file]), "--get-regexp", "url$"], cwd: dir, env, timeoutMs: 30_000 });
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const space = line.indexOf(" ");
      return space < 0 ? [] : [{ key: line.slice(0, space), url: line.slice(space + 1) }];
    });
  };
  const remotes = (await configured()).filter((entry) => /^(remote\..+\.(push)?url|submodule\..+\.url)$/i.test(entry.key));
  const targets: string[] = [];
  if (subcommand === "submodule") targets.push(...remotes.map((entry) => entry.url), ...(await configured(".gitmodules")).map((entry) => entry.url));
  const positional: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg === "--repo") positional.push(args[index + 1] ?? "");
    else if (arg.startsWith("--repo=")) positional.push(arg.slice("--repo=".length));
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  // A remote's name stands for its URLs; with no name, fetch, pull and push may use any configured remote.
  const named = (name: string): string[] => remotes.filter((entry) => entry.key.toLowerCase().startsWith(`remote.${name.toLowerCase()}.`)).map((entry) => entry.url);
  if ((subcommand === "fetch" || subcommand === "pull" || subcommand === "push") && positional.length === 0) targets.push(...remotes.map((entry) => entry.url));
  for (const arg of positional) {
    const urls = named(arg);
    targets.push(...(urls.length > 0 ? urls : [arg]));
  }
  for (const target of targets) {
    const local = localPath(target);
    if (local === undefined) continue;
    try {
      (mode === "write" ? writeGuard : guard).check(resolve(dir, local));
    } catch {
      throw new Error(`git "${subcommand}" may not reach ${target}: a local repository is ${mode === "write" ? "pushed to only in the job's writable area" : "read only inside the job workspace"}`);
    }
  }
}

export function createKernelGitTool(cwd: string, guard: PathGuard, writeGuard: PathGuard, tmp: string): ToolDefinition {
  return defineTool({
    name: "git",
    label: "git",
    description: "Runs a git subcommand in the job workspace. Read-only subcommands (status, log, diff, ...) run anywhere; mutating ones only where the job may write.",
    parameters,
    execute: async (_toolCallId, params, signal) => {
      const [subcommand, ...rest] = params.args;
      if (subcommand === undefined || !ALL_SUBCOMMANDS.has(subcommand)) {
        throw new Error(
          `unknown git subcommand "${subcommand ?? ""}": the first argument must be a git command name (git aliases are not expanded)`,
        );
      }
      const forbidden = findForbiddenOption(subcommand, rest);
      if (forbidden !== undefined) {
        throw new Error(`git option "${forbidden}" is not allowed: it redirects the repository, reaches outside the workspace or starts an external helper (give an option's value as a separate argument)`);
      }
      if (subcommand === "config" && (!rest.some((arg) => CONFIG_READS.has(arg)) || rest.some((arg) => CONFIG_REFUSED.has(arg.split("=")[0]!) || /^-f/.test(arg)))) {
        throw new Error('git "config" only reads here (--get, --get-all, --get-regexp, --list): configuration can make git run commands, so a job does not set it');
      }
      if (subcommand === "diff" && rest.includes("--no-index")) {
        throw new Error('git "diff --no-index" is not allowed: it compares files outside a repository, anywhere on disk; diff commits or the working tree of a repository instead');
      }
      if (subcommand === "submodule" && rest[0] === "foreach") {
        throw new Error('git "submodule foreach" is not allowed: it runs a shell command');
      }
      const unlisted = findUnlistedOption(subcommand, rest);
      if (unlisted !== undefined) throw new Error(unlistedMessage(subcommand, unlisted));
      const dir = params.cwd === undefined ? cwd : guard.check(params.cwd);
      if (subcommand === "diff") checkDiffPaths(rest, dir, guard);
      // The patches apply and am read are files: they stay in the workspace like the paths of diff (P-031).
      if (subcommand === "apply" || subcommand === "am") checkDiffPaths(rest, dir, guard);
      checkRepositoryPaths(subcommand, rest, dir, guard, writeGuard);
      if (!READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        try {
          writeGuard.check(dir);
        } catch {
          throw new Error(
            `git "${subcommand}" changes the repository and runs only in the job's writable area: pass a cwd under the output directory or scratch (clone or init the repository there first)`,
          );
        }
      }
      await mkdir(join(tmp, "no-hooks"), { recursive: true });
      const env: Record<string, string> = {
        ...jobEnvironment(tmp),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
        GIT_OPTIONAL_LOCKS: "0",
        // A long option abbreviated (`--upload=<cmd>` for --upload-pack) would pass the option checks above.
        GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS: "1",
        // `ext::` and `fd::` transports execute commands; the rest are ordinary remotes.
        // The list is colon-separated (git's GIT_ALLOW_PROTOCOL format).
        GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
        GIT_AUTHOR_NAME: "Kintsugi Job",
        GIT_AUTHOR_EMAIL: "job@kintsugi.invalid",
        GIT_COMMITTER_NAME: "Kintsugi Job",
        GIT_COMMITTER_EMAIL: "job@kintsugi.invalid",
        // Command-line-style configuration beats the repository's own config, which is untrusted.
        GIT_CONFIG_COUNT: "5",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: join(tmp, "no-hooks"),
        GIT_CONFIG_KEY_1: "core.fsmonitor",
        GIT_CONFIG_VALUE_1: "",
        GIT_CONFIG_KEY_2: "core.pager",
        GIT_CONFIG_VALUE_2: "cat",
        GIT_CONFIG_KEY_3: "core.askpass",
        GIT_CONFIG_VALUE_3: "",
        GIT_CONFIG_KEY_4: "credential.helper",
        GIT_CONFIG_VALUE_4: "",
      };
      await checkTransportPaths(subcommand, rest, dir, env, guard, writeGuard);
      const timeoutSec = clampTimeoutSec(params.timeout);
      const result = await runProcess({
        command: "git",
        args: TEXTCONV_SUBCOMMANDS.has(subcommand)
          ? [subcommand, "--no-ext-diff", "--no-textconv", ...rest]
          : TEXTCONV_ONLY_SUBCOMMANDS.has(subcommand)
            ? [subcommand, "--no-textconv", ...rest]
            : params.args,
        cwd: dir,
        env,
        timeoutMs: timeoutSec * 1000,
        signal,
      });
      const chunks: string[] = [];
      if (result.stdout !== "") chunks.push(result.stdout);
      if (result.stderr !== "") chunks.push(result.stderr);
      const bounded = boundOutput(chunks.join(chunks.length === 2 ? "\n" : ""), "head");
      let text = bounded.text === "" ? "(no output)" : bounded.text;
      const notices: string[] = bounded.notice === undefined ? [] : [bounded.notice];
      if (result.stopped === "timeout") notices.push(`git timed out after ${timeoutSec}s`);
      else if (result.stopped === "aborted") notices.push("git aborted");
      else if (result.stopped === "output-limit") notices.push("git output exceeded the capture limit");
      else if (result.exitCode !== 0) notices.push(`git exited with code ${result.exitCode}`);
      if (result.truncated) notices.push("output truncated");
      if (result.outlived === true) notices.push("A process it started was still running when it ended; its output was cut there");
      if (notices.length > 0) text = `${text}\n\n[${notices.join(". ")}]`;
      return { details: undefined, content: [{ type: "text", text }] };
    },
  });
}
