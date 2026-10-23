# Runtime and member harnesses

Kintsugi has two agent execution worlds with separate ownership ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md), [Coding Agent Workflow](../../decisions/0061-coding-agent-workflow-through-cli-and-local-mcp.md)).

| | **Kintsugi Runtime (pi)** | **Member harnesses** (Claude Code, GitHub Copilot, ChatGPT/Codex) |
|---|---|---|
| Where it runs | The Kintsugi installation, in the worker, in a per-job workspace | The member's machine; the installed CLI starts a local stdio MCP bridge that calls the HTTPS context API |
| Who drives it | Kintsugi's orchestrator, automatically or from the portal | The developer's chosen AI works interactively; Kintsugi supplies cited context and observes GitHub pull requests |
| What it does | Platform intelligence: assess, understand, generate selected design sets, review evidence and request decisions | The member's AI explains Kintsugi documents; the developer writes and tests code, common design and deliverable documents |
| Writes to project repos | The runtime writes only to job output; the worker commits or opens a PR in the document repo | The member works in normal code and document repos and opens ordinary pull requests |
| LLM license / cost | Providers configured in Kintsugi | The member's or customer's existing licenses |

The member bridge runs only when the AI client starts it. It has no inbound network listener. CLI commands and MCP tools call the same typed, read-only context API; the server checks the user's current Project Access on every request. Task briefs pin each source repository to an immutable Git revision and return citations. The selected AI reads those documents and answers the developer; Kintsugi does not need to run a separate conversational assistant.

```mermaid
sequenceDiagram
    actor Developer
    participant AI as Chosen coding agent
    participant Bridge as Local Kintsugi CLI MCP
    participant API as Kintsugi HTTPS API
    participant GitHub
    participant Worker as Kintsugi worker

    Developer->>AI: Ask about an assigned task
    AI->>Bridge: Task brief with project, unit and activity
    Bridge->>API: Authenticated context request
    API->>API: Check Project Access; create immutable snapshot
    API-->>Bridge: Readiness, context index, snapshot ID and citations
    Bridge-->>AI: Structured result and cited text
    AI-->>Developer: Explain task, standards, designs and evidence

    Developer->>GitHub: Implement, test and open an ordinary PR
    GitHub-->>API: Signed notification when configured
    Worker->>GitHub: Reconcile current PR, checks and reviews
    Worker->>Worker: Review a fixed revision and publish findings
    AI->>Bridge: Read task status, findings or replay events
    Bridge->>API: Authorized status, review or event request
    API-->>Bridge: Findings, blockers and resumable workflow events
    Bridge-->>AI: Cited status and next action
    Developer->>API: Authorized human gate decision
    API->>Worker: Publish and validate evidence-bound gate record
    Worker-->>API: Effective decision and exactly-once continuation
```

## The member workflow

1. The developer signs in with the CLI, selects an authorized project and installs the hookless Coding Agent Workflow plugin into the chosen client.
2. The AI asks Kintsugi for task context. The API checks current Project Access and returns a readiness summary, a bounded context index and an immutable snapshot ID.
3. The AI retrieves needed sections from that snapshot and explains them with citations. It may answer questions about the task, design, standards and evidence; reads do not claim or change the task.
4. The developer uses normal tools to implement and test, then opens a pull request in GitHub. Kintsugi discovers it through notifications and durable reconciliation, binds review results to exact revisions, and exposes current findings and status.
5. An authorized person makes the required gate decision. Kintsugi publishes a readable evidence record for review; only a merged record that validates against the required deliverables becomes effective and triggers the next workflow step.

The member harness never receives a Kintsugi service credential. The local bridge reads the operating-system credential store before each API call, so revoked Project Access takes effect on the next request. Provider-specific behavior is documented in the [harness integration reference](../../reference/harness-integration.md), the [CLI reference](../../reference/coding-agent-cli.md), and the [compatibility record](../../reference/coding-agent-workflow-compatibility.md).

## Why pi for the runtime

| Runtime need | What pi offers |
|---|---|
| Embeddable, TypeScript | SDK createAgentSession, used by a Node runner inside the job container |
| Kintsugi-specific tools | Extensions via registerTool; skills in the Agent Skills format |
| Control and audit | Tool-call and tool-result hooks |
| Multi-provider, on-prem capable | Anthropic, OpenAI, Azure OpenAI, Bedrock, Vertex and OpenAI-compatible providers |
| Small core | The runtime kernel stays generic; Kintsugi owns orchestration, job isolation and policy |

The runtime remains generic and does not write to code repositories. Member-specific task delivery belongs to the harness integration and its provider adapters.

## Why members keep their own harnesses

- Teams already use coding agents under existing licenses and habits.
- The same read-only Kintsugi context contract is available to supported clients through the local MCP bridge; each client's exact native setup is version-gated.
- The workflow evaluates the submitted pull request and its evidence. It does not treat a client's tool activity or plugin instructions as approval.

Reference: [runtime agents](../../reference/runtime-agents.md) · [harness integration](../../reference/harness-integration.md).
