# Runtime and member harnesses

Kintsugi has two kinds of agents with separate execution models ([ADR-0001](../../decisions/0001-pi-as-kintsugi-runtime.md)).

| | **Kintsugi Runtime (pi)** | **Member harnesses** (Claude Code, GitHub Copilot, ChatGPT/Codex) |
|---|---|---|
| Where it runs | The project Kintsugi installation, in the worker, one job workspace per job | Members' machines; the installed CLI launches a local stdio MCP bridge that calls the HTTPS member API |
| Who drives it | Kintsugi (orchestrator), automatically or on request from the portal | The member's chosen AI works interactively; Kintsugi supplies scoped context and observes Git PRs |
| What it does | A **generic agent kernel** ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)) for **platform intelligence**; the agents (knowledge, assessment, to-be analysis, planning, review / gates, reporting) are planned and supplied per job as data | **The actual work**: write / migrate code, tests, designs, deliverable documents |
| Writes to project repos | **Not directly.** The runner writes only to its output directory; the worker commits or opens a PR in the document repo | **Yes**, through the member's branches and PRs |
| LLM license / cost | Providers configured in Kintsugi ([LLM configuration](llm-configuration.md)) | The member's or customer's existing licenses |

~~~text
Kintsugi installation
  Portal / API ─ member HTTPS API ─ Harness Hub contracts and generated client assets
  GitHub adapter ─ PR reconciliation ─ review and gate workers ─ durable events / SSE
           ▲ HTTPS context and event stream                 │
           │                                                └─ fetch provider state
           │
Developer machine: chosen AI ─ local Kintsugi CLI / stdio MCP
           │                                 │
           └──── normal code and document pull requests ──► GitHub
~~~

## The standard loop

The intended loop; the runtime steps need agents that are not introduced yet ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)).

1. **Runtime prepares.** It pulls AS-IS context from the KB and produces a task pack. The worker commits the task pack to the document repo.
2. **The member implements** in their own harness. The chosen AI reads the task brief and cited documents through the local stdio MCP bridge or CLI; each follow-up retrieval stays on the same authorized snapshot.
3. **The member delivers.** The developer opens ordinary PRs in the target and document repositories. Kintsugi discovers them from GitHub provider state; task retrieval does not claim the unit.
4. **Kintsugi reviews** a complete fixed PR revision and returns cited findings. Human approvals and merged deliverables remain provider and Git evidence.
5. **After the deliverables merge**, an authorized human decision and merged evidence-bound gate record make the gate effective; Kintsugi records the workflow transition and streams progress to the portal or CLI.

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
- Repo `earendil-works/pi`, v1.1.0 (2026-10-07), Node ≥ 22.19.
- Releases ship almost daily, so pin the version.
- pi has **no sandbox and no permission system**. Kintsugi provides the isolation instead ([security](security.md)).

## Why members keep their own harnesses

- Teams already use Copilot, Claude Code or ChatGPT/Codex under existing licenses and habits.
- A small hookless member-access plugin starts the installed CLI local MCP bridge. It is separate from optional method plugins; each client target must pass its own setup and protocol tests ([ADR-0041](../../decisions/0041-member-access-through-cli-and-local-mcp.md)).
- The planned gate review evaluates the **result** (the PR), not how it was produced, so behavior differences between harnesses matter less.

Reference: [runtime agents](../../reference/runtime-agents.md) · [harness integration](../../reference/harness-integration.md).
