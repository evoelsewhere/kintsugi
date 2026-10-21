# Runtime and member harnesses

Kintsugi has two kinds of agents with separate execution models ([ADR-0001](../../decisions/0001-pi-as-kintsugi-runtime.md)).

| | **Kintsugi Runtime (pi)** | **Member harnesses** (Claude Code, GitHub Copilot, ChatGPT/Codex) |
|---|---|---|
| Where it runs | The project's Kintsugi installation, in the worker, one job workspace per job | Members' machines (IDE, CLI, desktop/web app) |
| Who drives it | Kintsugi (orchestrator), automatically or on request from the portal | The member, interactively |
| What it does | A **generic agent kernel** ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)) for **platform intelligence**; the agents (knowledge, assessment, to-be analysis, planning, review / gates, reporting) are planned and supplied per job as data | **The actual work**: write / migrate code, tests, designs, deliverable documents |
| Writes to project repos | **Not directly.** The runner writes only to its output directory; the worker commits or opens a PR in the document repo | **Yes**, through the member's branches and PRs |
| LLM license / cost | Providers configured in Kintsugi ([LLM configuration](llm-configuration.md)) | The member's or customer's existing licenses |

```
      ┌──────────────── Kintsugi (self-hosted installation) ───────────────────┐
      │  Portal / API ─ Orchestrator ─ Knowledge Hub ─ Governance               │
      │                      │                                                  │
      │      Kintsugi Runtime (pi, 1 container/job, read-only Git checkout)     │
      │   generic agent kernel; agents supplied per job (planned)               │
      │                      │                                                  │
      │      Harness Hub: MCP server · CLI API · asset rendering ·              │
      │                   telemetry ingest · policy distribution                │
      └───────┬──────────────────────────────▲───────────────────┬─────────────┘
   task pack, │ MCP / CLI          activity, │ telemetry          │ fetch / commit+PR (worker)
   skills, KB ▼                              │                    ▼
      ┌──────────────── Member machines ─────┴───┐   push/PR   ┌─────────────────────────────┐
      │  Claude Code · GitHub Copilot · ChatGPT/Codex │──────────►│ Git servers: code repos +   │
      └──────────────────────────────────────────┘             │ document repo (documents)  │
                                                               └─────────────────────────────┘
```

## The standard loop

The intended loop; the runtime steps need agents that are not introduced yet ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)).

1. **Runtime prepares.** It pulls AS-IS context from the KB and produces a task pack. The worker commits the task pack to the document repo.
2. **The member implements** in their own harness. The harness uses the KB through the Kintsugi MCP server or CLI.
3. **The member delivers.** Code goes to target repos and deliverables go to the document repo, both through PRs. The artifacts are then registered.
4. **Runtime reviews** the PR against the gate. A human approves.
5. **After merge**, the runtime enriches the TO-BE KB and the metrics are updated.

Flow details: [runtime view §6.3](../06-runtime-view.md#63-work-item-loop-member--harness).

## Why pi for the runtime

| Runtime need | What pi offers |
|---|---|
| Embeddable, TypeScript | SDK `createAgentSession` (package `@earendil-works/pi-coding-agent`, MIT), used by a Node runner inside the job container |
| Kintsugi-specific tools | Extensions via `registerTool`; skills in the Agent Skills format |
| Control and audit | `tool_call` hook (block or rewrite input), `tool_result` |
| Multi-provider, on-prem capable | pi-ai: Anthropic, OpenAI, Azure OpenAI, Bedrock, Vertex, any OpenAI-compatible server |
| Cost tracking | `usage.cost` on every message |
| Small core | Only read / bash / edit / write by default; orchestration stays in Kintsugi |

Survey as of 2026-10-09:
- Repo `earendil-works/pi`, v1.3.0 (2026-10-15), Node ≥ 22.19.
- Releases ship almost daily, so pin the version.
- pi has **no sandbox and no permission system**. Kintsugi provides the isolation instead ([security](security.md)).

## Why members keep their own harnesses

- Teams already use Copilot, Claude Code or ChatGPT/Codex under existing licenses and habits.
- The same task pack and the same agent plugins (skills, agents, hooks, MCP) work across harnesses: natively in Claude Code and Copilot CLI, converted for Codex, and rendered elsewhere ([ADR-0015](../../decisions/0015-member-assets-as-agent-plugins.md)).
- The planned gate review evaluates the **result** (the PR), not how it was produced, so behavior differences between harnesses matter less.

Reference: [runtime agents](../../reference/runtime-agents.md) · [harness integration](../../reference/harness-integration.md).
