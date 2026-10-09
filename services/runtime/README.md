# services/runtime

**Kintsugi Runtime** — executes Kintsugi's own agents (`runtime/agents/*`) on [pi](https://github.com/earendil-works/pi). Implements `AgentRuntime` from `packages/runtime-sdk`.

- `runner/` → image `kintsugi-runner`: thin Node process using the pi SDK (`createAgentSession`, `@earendil-works/pi-coding-agent` pinned exact), one container per job; streams `JobEvent`s to the job gateway in `kintsugi-app`.
- `launcher/` → runs in `kintsugi-worker`: builds the job's `models.json` + env from the LLM provider registry (ADR-0009) and starts the container through the Docker API (ADR-0004).
- `kintsugi` pi package (extensions): `policy` (`tool_call` allow/block + audit), `kb` (kb.search / kb.graph tools), `outputs` (write files to `/out`, post PR comments), `telemetry` (usage.cost → Monitoring).
- `/src` read-only (git checkout prepared by the worker), `/out` writable; the worker — not the runner — commits results to the workspace repo.

Agents do platform work only — knowledge, assessment, to-be analysis, task planning, gate review, insight. Implementation work happens in members' harnesses (see `services/harness-hub`).

Security rules: docs/architecture/concepts/security.md and docs/decisions/0004-runner-container-per-job.md.
