# services/runtime

**Kintsugi Runtime**: executes Kintsugi's built-in agents on [pi](https://github.com/earendil-works/pi). Implements `AgentRuntime` from `packages/runtime-sdk`.

## Current code (scaffold)

- `src/agent-runtime.ts` — `createAgentRuntime({ mode })`, the `AgentRuntime` contract with two backends.
- `src/pi-runtime.ts` — pi backend: one `AgentSession` per job (`createAgentSession`, `@earendil-works/pi-coding-agent` pinned exact, ADR-0018) with the full agent wiring: agent catalog prompt + skills, Kintsugi extensions (system prompt, policy), pi built-in extensions (codemode, tool_search, MCP) and the custom Kintsugi tools; pi events mapped onto `JobEvent`s.
- `src/agents/catalog.ts` — the built-in agents, fixed in code (ADR-0014): role prompt, skills, default tools/thinking/budget. `src/agents/system-prompt.ts` builds the session system prompt.
- `src/extensions/kintsugi.ts` — system-prompt extension and policy extension (`denyBashPatterns` enforced at tool-call time; blocked calls surface as `tool.call` decision `"blocked"`).
- `src/tools/kintsugi-tools.ts` — `kb_search` (gateway wiring pending) and `outputs_write` (writes into /out, path-guarded).
- `src/launcher/` — `model-runtime.ts` builds the job's pi `ModelRuntime` from the provider registry; `provider-registry.ts` reads `admin.llm_provider` + decrypts secrets.
- `src/bin/run-job.ts` — dev CLI: run one real job (`node dist/bin/run-job.js --provider <id> --model <id> [--instruction …] [--deny-bash <pattern>] [--out <dir>]`).
- `src/mock-agent.ts`, `src/event-stream.ts`, `src/job-inputs.ts`, `src/version.ts`.

The runner/launcher split below is the target shape; the container image lands with the Docker work.

## Planned layout

- **Agents** (`agents/<id>/`): one directory per built-in agent.
  - Each agent's prompt, skills (`SKILL.md`), tools, policy and default budget are **fixed in code** and versioned with the Kintsugi release.
  - There is no agent configuration in any repo (ADR-0014).
  - The catalog is in docs/reference/runtime-agents.md.
- **`runner/`** → image `kintsugi-runner`.
  - A thin Node process using the pi SDK (`createAgentSession`, `@earendil-works/pi-coding-agent` pinned to an exact version).
  - One container per job; it streams `JobEvent`s to the job gateway in `kintsugi-app`.
- **`launcher/`** → runs in `kintsugi-worker`.
  - Builds the job's `models.json` and environment from the LLM provider registry (ADR-0009).
  - Starts the container through the Docker API (ADR-0004).
- **`kintsugi` pi package** (extensions):
  - `policy`: `tool_call` allow/block + audit;
  - `kb`: the `kb.search` tool;
  - `outputs`: write files to `/out`, post PR comments;
  - `telemetry`: usage.cost → Monitoring.
- **Filesystem**:
  - `/src` is a read-only git checkout prepared by the worker, which agents read directly with file tools; there is no code graph or parser.
  - `/out` is writable. The worker, not the runner, commits results to the workspace repo.

Agents do platform work only: knowledge, assessment, to-be analysis, task planning, gate review, insight. Implementation work happens in members' harnesses (see `services/harness-hub`). What projects control is the rulebook content agents read, plus the model binding per agent.

Security rules: docs/architecture/concepts/security.md and docs/decisions/0004-runner-container-per-job.md.
