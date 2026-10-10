# services/runtime

**Kintsugi Runtime**: a generic agent kernel on [pi](https://github.com/earendil-works/pi) (ADR-0023). It runs one agent job at a time and implements `AgentRuntime` from `packages/runtime-sdk`. It knows no agent and no use case: every `JobSpec` carries the whole agent definition (instructions, skills, tool allowlist, command policy, thinking level), the task, the model, the workspace and the limits. No agent ships with Kintsugi.

## Code

- `src/agent-runtime.ts` — `createAgentRuntime({ mode })` with two backends: `"pi"` (needs `resolveModelRuntime`) and `"mock"` (no LLM).
- `src/pi-runtime.ts` — pi backend: validates the job, builds the session, runs the task.
- `src/kernel/`
  - `session.ts` — a locked-down pi session per job: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, MCP, codemode or tool search; an empty scratch agent directory, deleted when the job ends; the system prompt is the agent's instructions plus its skills, verbatim.
  - `tools.ts` — the kernel tool registry: `read`, `ls`, `grep`, `find` (confined to `workspace.readOnly`) and `outputs_write` (confined to `workspace.outDir`). Only allowlisted tools are created; pi registers nothing else.
  - `paths.ts` — path confinement (symlinks resolved).
  - `policy.ts` — system prompt composition and the `denyCommandPatterns` tool-call hook.
  - `job.ts` — maps pi events onto `JobEvent`s, enforces `timeoutSec` / `maxTurns` / `maxCostUsd`, and reads the outcome from the last assistant message (LLM errors and aborts end as `job.failed`).
  - `validate.ts` — rejects jobs with unknown tools, missing directories or invalid limits before anything starts.
- `src/launcher/` — runs on the worker side: `provider-registry.ts` reads `admin.llm_provider` and decrypts secrets; `model-runtime.ts` builds the job's pi `ModelRuntime` in memory (no `models.json`, no `auth.json`, nothing from the host's `~/.pi`).
- `src/bin/run-job.ts` — dev CLI, see below.
- `src/mock-agent.ts`, `src/event-stream.ts`, `src/version.ts`.

## Dev runner

Write an agent definition to a JSON file outside the repo, for example `{"id":"probe","version":"0.1.0","instructions":"Answer briefly.","tools":["read"]}`, then:

```bash
node dist/bin/run-job.js --agent-file probe.json --read <dir> --out <dir> --task "..." --mock
node dist/bin/run-job.js --agent-file probe.json --read <dir> --out <dir> --task "..." --provider <id> --model <id>
```

`--max-turns`, `--timeout` and `--max-cost` set the limits. The dev runner runs in-process, without the job sandbox: point `--read` only at directories you trust.

## Planned

- **Runner** → a thin process per job inside the job sandbox (ADR-0004; proposed ADR-0021), streaming `JobEvent`s to the job gateway in `kintsugi-app`.
- **Launcher** → in `kintsugi-worker`: resolves the provider and credentials (ADR-0009), passes provider environment to the runner, prepares the read-only checkout and the output directory, and commits outputs per ADR-0019.
- **Agents** → none yet. Where agent definitions are stored and edited is decided with the first agent (ADR-0023).
- **More kernel tools** (knowledge-base search, git history, …) are added to `src/kernel/tools.ts` with a review of their security boundary.

Security rules: [security concept](../../docs/architecture/concepts/security.md), [ADR-0004](../../docs/decisions/0004-runner-container-per-job.md), [ADR-0023](../../docs/decisions/0023-runtime-as-generic-agent-kernel.md).
