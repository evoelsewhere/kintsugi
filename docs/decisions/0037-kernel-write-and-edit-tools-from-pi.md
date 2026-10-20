# ADR-0037: The kernel writes with pi's `write` and `edit`, not a custom `outputs_write`

- Status: Accepted. Decision 4 (`bash` stays out of the kernel) superseded by [ADR-0040](0040-kernel-shell-and-git-tools.md)
- Date: 2026-10-14
- Decision register: D28 (amended)

## Context
[ADR-0023](0023-runtime-as-generic-agent-kernel.md) gave the runtime kernel five tools: pi's own `read`, `ls` and `find` over the read-only workspace, an in-process `grep`, and a Kintsugi-written `outputs_write` that wrote one file to the job's output directory. pi's `write` and `edit` were left out on purpose, since they work anywhere on the filesystem. `outputs_write` was a second write tool with its own name, schema and prompt text, which models do not know, and it could only create or overwrite a whole file: a small change to an output meant rewriting it.

pi lets a host replace the file operations of its tools, and it already runs `read`, `ls` and `find` that way (confined by `PathGuard`, ADR-0029).

## Decision
1. `outputs_write` is removed. The kernel offers **pi's own `write` and `edit`**, created by `tools.ts` with their file operations confined to the job's output directory: every path (symlinks resolved) must stay inside it, so the read-only roots and the rest of the filesystem are out of reach, and `edit` can only change a file the job has written.
2. The output tools run with the output directory as their working directory: a relative path such as `report/result.md` is relative to it, as it was for `outputs_write`. The read tools keep the first read-only root as theirs.
3. Every file that `write` or `edit` saves is reported as a job output, as before; the tool-call summary keeps the path and never the content or the replaced text.
4. `bash` stays out of the kernel. The kernel tool names are `read`, `ls`, `grep`, `find`, `write`, `edit`; built-in agents list `write, edit` where they listed `outputs_write`, and a stored custom agent is rewritten by migration `017_agent_write_tools.sql`.

## Consequences
- Agents use the tool names and schemas they know from pi; a change to an output is an `edit` instead of a full rewrite.
- The security boundary is unchanged: writes still reach only the output directory, `bash` is still absent, and the session tests cover a `write` and an `edit` that try to leave it.
- An agent that names `outputs_write` is refused by validation ("unknown tool"); the migration rewrites the stored ones, and an exported agent file with the old name must be edited.
- ADR-0023 and ADR-0026 mention `outputs_write` as written at the time; this decision supersedes those mentions.

## Alternatives considered
- **Keep `outputs_write` and add an edit tool of our own**: two more tools with names models do not know.
- **Give pi's `write` and `edit` the whole workspace**: lets a job write over its read-only inputs.
