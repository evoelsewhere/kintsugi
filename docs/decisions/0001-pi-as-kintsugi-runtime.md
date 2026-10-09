# ADR-0001: pi is the Kintsugi Runtime; members implement with their own harnesses

- Status: Accepted
- Date: 2026-10-09

## Context
Kintsugi needs its own agents for platform work: knowledge ingestion, KB Q&A, assessment, wave planning, to-be analysis, task planning, gate review, and insight reporting. Implementation work (code, tests, designs, documents) is done by project members, who already use Claude Code, GitHub Copilot and ChatGPT/Codex on their own machines under existing licenses.

## Decision
- **pi** (`@earendil-works/pi-coding-agent`, MIT) is the **Kintsugi Runtime**. It runs the runtime agents server-side, embedded via SDK (or RPC) in `services/runtime`, behind the `AgentRuntime` contract (`packages/runtime-sdk`).
- The runtime reads project sources but **never writes to project repositories**. It writes only to its container's `/out`; the worker commits results to the project's workspace repo (ADR-0007), and on code repos it only comments on PRs.
- **Member harnesses** (Claude Code, Copilot, ChatGPT/Codex) do the implementation. Kintsugi does not drive them. `services/harness-hub` supplies context (task packs, skills, Kintsugi MCP/CLI) and ingests results (PRs, artifacts, telemetry), following `packages/harness-sdk`.

## Consequences
- Pros:
  - pi is small, embeddable, multi-provider and TypeScript-native.
  - The `tool_call` hook gives policy and audit; every message carries its cost.
  - Teams keep the tools and licenses they already have.
- Cons:
  - pi has no sandbox or permission system, so Kintsugi owns isolation (ADR-0004).
  - pi moves fast (1.0 shipped 2026-10-01, releases near-daily). Pin exact versions; an eval suite gates upgrades.
  - Earendil's licensing of non-core layers is still open, so depend only on the MIT core packages.
  - Visibility into member harnesses is uneven, so AI metrics rely on Kintsugi MCP/CLI and PR conventions first, and vendor telemetry second.
