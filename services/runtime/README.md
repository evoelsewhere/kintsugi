# services/runtime

**Kintsugi Runtime**: executes Kintsugi's built-in agents on [pi](https://github.com/earendil-works/pi). Implements `AgentRuntime` from `packages/runtime-sdk`.

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
