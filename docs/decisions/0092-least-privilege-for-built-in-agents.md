# ADR-0092: Built-in agents list their tools, and none gets `shell` or `codemode`

- Status: Accepted
- Date: 2026-11-01
- Decision register: D106
- Amends [ADR-0040](0040-kernel-shell-and-git-tools.md) (which tools the built-in agents get)
- Related: [ADR-0023](0023-runtime-as-generic-agent-kernel.md), [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md), [ADR-0047](0047-kernel-extensions-codemode-and-http-mcp.md)

## Context

An agent file without `tools` gets every kernel tool (`packages/agents/src/definition.ts`), and none of the
nine built-in agents listed its tools. So every built-in job was granted `shell`, `git` and `codemode`
next to the file tools, while the tasks the plans give them say "you have no shell" and "you cannot run it".
Three problems follow:

- **Prompt injection reaches a process.** The built-in agents read untrusted legacy code. With `shell`,
  instruction-shaped text in that code is one tool call away from a process in the worker's account,
  which can read what the worker's environment and file system expose (ADR-0029's boundary is the OS
  account, not the tool).
- **Unbounded writes.** A `shell` call can write gigabytes to the job's scratch in one call; the disk is
  usually the database's disk too.
- **Contradictory prompts.** The model is told it has no shell and is offered one. A model that tries it
  anyway spends turns on a tool its task said it does not have; one that believes the task never needs it.

No built-in task needs to run a command: scripts run as script steps (ADR-0033), and the agents read,
write and edit documents. `git` is useful where a task reads a change: the code review reads a member's
merge request.

## Decision

Every built-in agent declares `tools`, the least its tasks need:

| Agent | Tools | Why |
|---|---|---|
| legacy-analyst | read, ls, grep, find, write, edit | reads the source, writes its notes and the topology script, which it refines with `edit` |
| business-rules-extractor | read, ls, grep, find, write, edit | reads the source, writes the rule documents |
| security-auditor | read, ls, grep, find, write, edit | static review by reading; no scanner runs in a job |
| understand-planner | read, ls, grep, find, write, edit | plans from the catalog and the graph, writes the plan |
| designer | read, ls, grep, find, write, edit | writes and edits the design documents of one set |
| architecture-critic | read, ls, grep, find, write, edit | reviews documents, writes its findings |
| contract-reviewer | read, ls, grep, find, write, edit | reviews designs together, writes its note |
| design-reviewer | read, ls, grep, find, write, edit | reviews one unit's designs, writes its note |
| code-reviewer | read, ls, grep, find, write, edit, git | reads the merge request; `git` only for its diff and history |

- Every agent keeps `write` and `edit`: when the output checks reject a file, the runner asks the job to
  fix it with `edit` (`services/orchestrator/src/jobs/runner.ts`, the output-fix note).
- No built-in agent gets `shell` or `codemode`. The agents' own texts and the plans' tasks say what the
  agent has (the file tools, and `git` for the code review) instead of promising a boundary for tools they
  do not have.
- An agent with `git` counts as shell-like for review purposes: the kernel's `git` tool refuses writes
  outside the workspace and a list of options, but it starts a process.
- Web and project-memory tools are not part of `tools`: they keep their own grants (ADR-0077, ADR-0080).
- Agents created in the Agent Builder (ADR-0026) are not affected: an administrator still chooses their
  tools, and an agent file without `tools` still gets every kernel tool.

The built-in plugin tests pin the table.

## Consequences

- A prompt injection in legacy code can no longer start a process from a built-in understanding,
  design or review job; the code review can start `git` only.
- A built-in job cannot fill the disk through a command; what it writes goes through `write` and `edit`.
- A task that one day needs to run something gets it as a script step, or the agent's `tools` grows with
  a new row in this table.
- Follow-up: the Agent Builder could warn when an administrator grants `shell` or `git` to an agent that
  reads untrusted code.
