# Runtime and member harnesses

Kintsugi has one agent execution world today: the Kintsugi Runtime ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)). Member harnesses (Claude Code, GitHub Copilot, ChatGPT/Codex) are not integrated: the Coding Agent Workflow was removed ([ADR-0067](../../decisions/0067-remove-access-and-review-plugins.md)) and later plugins attach any such integration.

| | **Kintsugi Runtime (pi)** |
|---|---|
| Where it runs | The Kintsugi installation, in the worker, in a per-job workspace |
| Who drives it | Kintsugi's orchestrator, automatically or from the portal |
| What it does | Platform intelligence: assess, understand, generate selected design sets, request decisions at the gates |
| Writes to project repos | The runtime writes only to job output; the worker commits or opens a PR in the document repo |
| LLM license / cost | Providers configured in Kintsugi |

## Why pi for the runtime

| Runtime need | What pi offers |
|---|---|
| Embeddable, TypeScript | SDK createAgentSession, used by a Node runner inside the job container |
| Kintsugi-specific tools | Extensions via registerTool; skills in the Agent Skills format |
| Control and audit | Tool-call and tool-result hooks |
| Multi-provider, on-prem capable | Anthropic, OpenAI, Azure OpenAI, Bedrock, Vertex and OpenAI-compatible providers |
| Small core | The runtime kernel stays generic; Kintsugi owns orchestration, job isolation and policy |

The runtime remains generic and does not write to code repositories.

Reference: [runtime agents](../../reference/runtime-agents.md).
