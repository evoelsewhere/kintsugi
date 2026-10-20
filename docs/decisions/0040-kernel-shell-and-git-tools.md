# ADR-0040: The kernel gets `shell` and `git` tools and an `ls` tree mode

- Status: Accepted
- Date: 2026-10-19
- Decision register: D27, D32, D47, D48
- Supersedes ADR-0037 decision 4 (`bash` stays out of the kernel) and the no-shell statements of ADR-0029
- Related: [ADR-0023](0023-runtime-as-generic-agent-kernel.md), [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md), [ADR-0037](0037-kernel-write-and-edit-tools-from-pi.md)

## Context

The kernel tool set was `read`, `ls`, `grep`, `find`, `write`, `edit`. Models know a shell and git
intimately; the phases need them anyway — build a generated project, run a test suite, inspect
history and diffs — and a "tool not available" gap pushes that work outside the product. Two facts
shaped the design:

- **Script steps already run arbitrary code.** A script step runs model-written code as a child
  process in the job's OS account, with a cleared environment and no credentials (ADR-0029). A
  shell tool is the same boundary made interactive; it adds no new crossing.
- **A shell is only as confining as the OS account.** Path guards on file tools are defense in
  depth, not the isolation boundary (ADR-0029 D47/D48). What remains to design is not "whether a
  shell can be confined" (it cannot, beyond the account) but that every process the kernel starts
  obeys the same process rules and that git stays inside the workspace by itself.

## Decision

1. **`shell`** replaces pi's bash shape (`command`, `timeout` in seconds) with kernel-owned
   execution: every call is one `bash -c` process through the launcher's `runProcess` — the job's
   cleared environment (`HOME`, `TEMP`, `TMPDIR` at the job's scratch), a wall-clock timeout
   (default 60 s, max 600 s), the capture cap and kill-tree on timeout or abort. No state (cwd,
   variables) survives a call. pi's bash tool itself is never registered: it keeps a persistent
   shell in the host's environment and writes spill files outside `out`.

2. **`git`** takes an explicit argument list — no shell, no alias expansion (the first argument
   must be a real git subcommand, because git expands a configured `alias.x '!command'` for any
   other name) and no option that redirects the repository, loads configuration or starts a helper
   (`-c`, `-C`, `--git-dir`, `--work-tree`, `--config`, `--upload-pack`/`-u`, `--exec`,
   `--ext-diff`, `--textconv`, `--output`, `submodule foreach`). Read-only subcommands (`status`,
   `log`, `diff`, `show`, `blame`, ...) run anywhere in the job workspace; every other subcommand
   runs only where the job may write (`out/`, the scratch) — a mutating command must not touch a
   checkout the job only reads, so the agent clones or inits the repository there first. The
   environment is the job's cleared one plus git hardening: `GIT_CONFIG_NOSYSTEM`, no prompts, no
   pager, `GIT_OPTIONAL_LOCKS=0`, neutral commit identity, hooks at an empty directory,
   `core.fsmonitor`/`diff.external`/`core.pager`/`core.askpass`/`credential.helper` overridden at
   command-line scope, and `GIT_ALLOW_PROTOCOL=file:git:http:https:ssh` so `ext::`/`fd::`
   transports cannot run a command.

3. **`ls`** keeps pi's flat listing unchanged and gains `tree` and `depth` parameters (`depth`
   implies `tree`; default depth 3, max 8, capped listing): pi's definition cannot take extra
   parameters, so the kernel wraps it and renders the tree itself under the same guards.

4. The kernel tool set is `read`, `ls`, `grep`, `find`, `write`, `edit`, `shell`, `git`
   (`tool-names.ts`; agent allowlists name them per agent).

## Consequences

- Runtime jobs can build, test and inspect history; the built-in runtime agents allowlist the full
  set. Prompt text that promised "no shell" is rewritten to describe the boundary instead.
- The boundary to defend is the job's OS account (a read-only worktree at the OS level where
  available, no credentials in the environment, capped output, redacted audit events) — unchanged
  from ADR-0029, but now also what `shell` runs behind. `git`'s own guards are defense in depth for
  agents that are granted `git` but not `shell`.
- Residual risk accepted: a repository under review can still name a textconv driver for the
  subcommands where `--no-textconv` does not apply; that runs inside the same account with no
  secrets in the environment, equivalent to `shell`, which these agents also hold.
- ADR-0037 decision 4 and ADR-0029's "runtime agent jobs have no shell" are superseded by this
  decision. The write-confinement consequence of ADR-0037 (file tools confined to `out`) stands.

## Alternatives considered

- **Keep `bash` out of the kernel.** Rejected: the phases need it, and script steps already run
  arbitrary code in the same account; the tool version is auditable per call, the script version
  hides it inside a step.
- **pi's `createBashToolDefinition` with custom operations.** Rejected: its session keeps a
  persistent shell and its output accumulator writes spill files outside `out`; wrapping it costs
  the same work as owning the tool and keeps pi-specific behavior in the boundary path.
- **`git` as a read-only tool only.** Rejected: provenance and same-stack uplift work need commits
  and checkouts; writes are confined to a clone under `out/`/scratch instead.
- **A separate `tree` tool.** Rejected: `ls` is the tool models reach for when looking around;
  tree is a shape of the same answer, so it is a parameter.
