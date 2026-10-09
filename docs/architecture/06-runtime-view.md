# 6. Runtime view

## 6.1 A runtime job (example: `assessment`)

```
User ─► API ─enqueue─► pg-boss ─► Worker ─fetch─► Git servers
                                    │
                                    ├─ docker run kintsugi-runner (/src ro, /out rw, job token, LLM env)
                                    │        │
                                    │        ├─► egress-proxy ─► LLM provider
                                    │        └─► kintsugi-app job gateway (JobEvents, kb.* tools) ─► Postgres ─NOTIFY─► SSE ─► Portal
                                    │
                                    └─ on agent_settled: validate /out ─► commit / PR in workspace repo ─► remove container
```

1. A user clicks "Assess". The API enqueues a pg-boss job.
2. The worker fetches the latest commits of the relevant code repos and the workspace repo, then prepares a checkout directory for the job.
3. The worker resolves the agent (`runtime/agents/assessment@version`) and its bound provider/model, then starts `kintsugi-runner` through the Docker API:
   - mounts: `/src` read-only, `/out` writable;
   - environment: only the credentials of the LLM provider in use, plus a short-lived job token;
   - network: internal `jobs` network, which reaches only `kintsugi-app` and `egress-proxy`.
4. The runner creates a pi session through the SDK (`createAgentSession`, tools per policy, `kintsugi` extension). Each event goes `POST /internal/jobs/:id/events` → Postgres → `NOTIFY` → SSE to the portal.
5. The runner's `kb.search` / `kb.graph` tools call the Kintsugi API with the job token (read-only, scoped to the project).
6. When the job ends (`agent_settled`), the worker reads `/out`, validates it (allowed paths, size, secret scan), commits or opens a PR in the workspace repo according to the agent's `outputs`, and removes the container.

## 6.2 Work item loop (member + harness)

1. `task-planner` produces the task pack; the worker commits `tasks/<id>.md` to the workspace repo.
2. The member runs `kintsugi task start <id>` (or MCP `task.next`) and gets the task pack plus skills rendered for their harness.
3. The member works in Claude Code / Copilot / ChatGPT-Codex:
   - queries the KB through MCP;
   - commits code to the code repo;
   - commits deliverables to the workspace repo;
   - opens PRs;
   - registers artifacts with `artifact.register`.
4. The worker detects the PR (webhook or polling) and runs a `gate-reviewer` job, which posts PR comments, writes a review record and updates the gate.
5. A human approves and merges. Git sync triggers `knowledge-ingest` to enrich the TO-BE KB, and Monitoring updates the AI metrics.

Step-by-step instructions for members: [member workflow guide](../guides/member-workflow.md).

## 6.3 KB question & answer

Questions come from the portal chat or from a member's harness (MCP `kb.ask`).
1. `kb-assistant` runs as an interactive runtime job; follow-up messages are passed with `followUp`.
2. It answers with citations (`repo@commit:path`, `path:line`).

## 6.4 Git sync and change detection

1. Per repository, the worker keeps the last seen commit (`GitSyncState`).
2. **Detecting changes**:
   - Polling (default, every `KINTSUGI_GIT_POLL_INTERVAL` seconds) fetches each repo and compares heads.
   - When the Git server can reach the installation, provider webhooks trigger the same sync immediately.
3. **Reacting to changes**:
   - New commits on tracked branches enqueue `knowledge-ingest` (incremental).
   - New or updated PRs enqueue `gate-reviewer`.
   - Servers without a provider adapter get sync and branch polling only.
