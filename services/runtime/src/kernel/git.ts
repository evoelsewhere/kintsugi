// The kernel `git` tool (ADR-0039): git subcommands as an explicit argument list — no shell, no
// alias expansion (the first argument must be a real git command), and no option that redirects
// the repository, loads extra configuration or starts an external helper. Read-only subcommands
// run anywhere in the job workspace; every other subcommand runs only where the job may write
// (the output directory or the scratch), because a mutating command must not touch a checkout
// the job only reads — clone or init the repository there first. The environment is the job's
// cleared one plus git hardening: no system or global configuration, no prompts, no pager,
// neutral commit identity, hooks and fsmonitor pointed at nothing, and only network protocols
// that cannot start a command. Repository configuration can still name a textconv driver; that
// runs inside the same account with no secrets in the environment (ADR-0029), so it is residual
// risk shared with the shell tool, not a new boundary.

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "../launcher/process.js";
import { jobEnvironment } from "../launcher/script.js";
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
];

/** Subcommands that accept `--no-textconv` to keep repository-configured converters (which are
 * commands) out of diff rendering. */
const TEXTCONV_SUBCOMMANDS = new Set(["diff", "log", "show"]);

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

function findForbiddenOption(args: readonly string[]): string | undefined {
  for (const arg of args) {
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (FORBIDDEN_OPTIONS.includes(name)) return arg;
  }
  return undefined;
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
      const forbidden = findForbiddenOption(rest);
      if (forbidden !== undefined) {
        throw new Error(`git option "${forbidden}" is not allowed: it redirects the repository or starts an external helper`);
      }
      if (subcommand === "submodule" && rest[0] === "foreach") {
        throw new Error('git "submodule foreach" is not allowed: it runs a shell command');
      }
      const dir = params.cwd === undefined ? cwd : guard.check(params.cwd);
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
        GIT_EXTERNAL_DIFF: "",
        GIT_OPTIONAL_LOCKS: "0",
        // `ext::` and `fd::` transports execute commands; the rest are ordinary remotes.
        // The list is colon-separated (git's GIT_ALLOW_PROTOCOL format).
        GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
        GIT_AUTHOR_NAME: "Kintsugi Job",
        GIT_AUTHOR_EMAIL: "job@kintsugi.invalid",
        GIT_COMMITTER_NAME: "Kintsugi Job",
        GIT_COMMITTER_EMAIL: "job@kintsugi.invalid",
        // Command-line-style configuration beats the repository's own config, which is untrusted.
        GIT_CONFIG_COUNT: "6",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: join(tmp, "no-hooks"),
        GIT_CONFIG_KEY_1: "core.fsmonitor",
        GIT_CONFIG_VALUE_1: "",
        GIT_CONFIG_KEY_2: "diff.external",
        GIT_CONFIG_VALUE_2: "",
        GIT_CONFIG_KEY_3: "core.pager",
        GIT_CONFIG_VALUE_3: "cat",
        GIT_CONFIG_KEY_4: "core.askpass",
        GIT_CONFIG_VALUE_4: "",
        GIT_CONFIG_KEY_5: "credential.helper",
        GIT_CONFIG_VALUE_5: "",
      };
      const timeoutSec = clampTimeoutSec(params.timeout);
      const result = await runProcess({
        command: "git",
        args: TEXTCONV_SUBCOMMANDS.has(subcommand) ? [subcommand, "--no-textconv", ...rest] : params.args,
        cwd: dir,
        env,
        timeoutMs: timeoutSec * 1000,
        signal,
      });
      const chunks: string[] = [];
      if (result.stdout !== "") chunks.push(result.stdout);
      if (result.stderr !== "") chunks.push(result.stderr);
      let text = chunks.join(chunks.length === 2 ? "\n" : "");
      if (text === "") text = "(no output)";
      const notices: string[] = [];
      if (result.stopped === "timeout") notices.push(`git timed out after ${timeoutSec}s`);
      else if (result.stopped === "aborted") notices.push("git aborted");
      else if (result.stopped === "output-limit") notices.push("git output exceeded the capture limit");
      else if (result.exitCode !== 0) notices.push(`git exited with code ${result.exitCode}`);
      if (result.truncated) notices.push("output truncated");
      if (notices.length > 0) text = `${text}\n\n[${notices.join(". ")}]`;
      return { details: undefined, content: [{ type: "text", text }] };
    },
  });
}
