# services/runtime

**Kintsugi Runtime**: a generic agent kernel on [pi](https://github.com/earendil-works/pi) (ADR-0023). It runs one agent job at a time and implements `AgentRuntime` from `packages/runtime-sdk`. It knows no agent and no use case: every `JobSpec` carries the whole agent definition (instructions, skills, tool allowlist, command policy, thinking level), the task, the model, the workspace and the limits. Agents (built-in and custom) are installation data resolved by the launcher (ADR-0026); the kernel never looks one up.

## Code

- `src/agent-runtime.ts` — `createAgentRuntime({ mode })` with two backends: `"pi"` (needs `resolveModelRuntime`) and `"mock"` (no LLM).
- `src/pi-runtime.ts` — pi backend: validates the job, builds the session, runs the task.
- `src/kernel/`
  - `session.ts` — a locked-down pi session per job: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, MCP, codemode or tool search; an empty scratch agent directory, deleted when the job ends; the system prompt is the agent's instructions plus its skills, verbatim.
  - `grep.ts` — the kernel `grep`: searches the read-only roots in-process through the path guard (no `ripgrep` on the host or in a job).
  - `tools.ts` — the kernel tool registry: `read`, `ls`, `grep`, `find` (confined to `workspace.readOnly`) and pi's `write` and `edit` (confined to `workspace.outDir`, relative paths start there). Only allowlisted tools are created; pi registers nothing else.
  - `paths.ts` — path confinement (symlinks resolved).
  - `policy.ts` — system prompt composition and the `denyCommandPatterns` tool-call hook.
  - `job.ts` — maps pi events onto `JobEvent`s, enforces `timeoutSec` / `maxTurns` / `maxCostUsd`, and reads the outcome from the last assistant message (LLM errors and aborts end as `job.failed`).
  - `validate.ts` — rejects jobs with unknown tools, missing directories or invalid limits before anything starts.
- `src/launcher/` — runs on the worker side, exported as `@kintsugi/runtime/launcher` (ADR-0029); knows no agent, script or stage:
  - `workspace.ts` — marks a job's `src` and `in` read-only, measures and removes job directories;
  - `process.ts` — child processes with an explicit command (no shell), a complete environment, a wall-clock timeout, an output-size watch and a process-tree kill (`taskkill /T /F` on Windows, the process group elsewhere);
  - `script.ts` — script steps: Python as `-I -B -X utf8`, Node with `--permission` limited to the workspace, the cleared job environment (`PATH`, `HOME`/`TEMP` into scratch, no credentials), the script's sha256, a redacted failure reason;
  - `agent-process.ts` — agent jobs as child processes (`createChildAgentRuntime`): `bin/agent-job.js` per job, `cwd` = the job directory, the cleared environment plus the provider's environment credentials, Node's permission model, timeout and tree kill; `JobSpec` and API key on stdin, `JobEvent`s back as JSON lines;
  - `provider-registry.ts` reads `admin.llm_provider` and decrypts secrets; `model-runtime.ts` builds the job's pi `ModelRuntime` in memory (no `models.json`, no `auth.json`, nothing from the host's `~/.pi`).
- `src/catalog/provider-catalog.ts` — the builtin providers and models of the pinned pi release plus the supported custom wire protocols, in a pi-agnostic shape. Exported as `@kintsugi/runtime/provider-catalog`; `apps/api` serves it to the portal (`GET /api/admin/llm-providers/supported`), so pi-specific code stays in this service.
- `src/bin/agent-job.ts` — the agent job child process the launcher starts (not a command for people).
- `src/bin/run-job.ts` — dev CLI, see below.
- `src/mock-agent.ts`, `src/event-stream.ts`, `src/version.ts`.

## Tests

`pnpm test` runs the kernel suite (vitest, `test/`). Kernel tests drive real pi sessions with pi-ai's faux provider: no network, no LLM, no credentials. They cover path confinement, the tool allowlist, the session lockdown, job limits and outcomes, and scratch-directory cleanup. `launcher.test.ts` runs script steps with the local Python and Node on any OS: cleared environment, read-only marking, timeout with process-tree kill, output cap and Node's permission model.

## Dev runner

Write an agent definition to a JSON file outside the repo, for example `{"id":"probe","version":"0.1.0","instructions":"Answer briefly.","tools":["read"]}`, then:

```bash
node dist/bin/run-job.js --agent-file probe.json --read <dir> --out <dir> --task "..." --mock
node dist/bin/run-job.js --agent-file probe.json --read <dir> --out <dir> --task "..." --provider <id> --model <id>
```

`--max-turns`, `--timeout` and `--max-cost` set the limits. The dev runner runs in-process, without the job sandbox: point `--read` only at directories you trust.

## Planned

- **Agents** → installation data managed in the Agent Builder; built-in packages live in `packages/agents/builtin/` (ADR-0026). The kernel tool names are exported without pi as `@kintsugi/runtime/tool-names`, for validating agent tool allowlists.
- **More kernel tools** (knowledge-base search, git history, …) are added to `src/kernel/tools.ts` with a review of their security boundary.

Security rules: [security concept](../../docs/architecture/concepts/security.md), [ADR-0029](../../docs/decisions/0029-job-workspaces-instead-of-os-sandboxes.md), [ADR-0023](../../docs/decisions/0023-runtime-as-generic-agent-kernel.md).
