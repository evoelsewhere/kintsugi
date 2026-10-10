# 6. Runtime view

Some runtime agents named on this page (`assessment`, `task-planner`, `gate-reviewer`, …) predate the built-in set of [ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md) (`legacy-analyst`, `business-rules-extractor`, `version-delta-analyst`, `architecture-critic`, `security-auditor`) and describe intent. Every agent is an agent definition supplied per job to the generic runtime kernel ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)).

## 6.1 A runtime job (example: `assessment`)

```
User ─► API ─enqueue─► pg-boss ─► Worker ─fetch─► Git servers
                                    │
                                    ├─ docker run kintsugi-runner (/src ro, /out rw, job token, LLM env)
                                    │        │
                                    │        ├─► egress-proxy ─► LLM provider
                                    │        └─► kintsugi-app job gateway (JobEvents) ─► Postgres ─NOTIFY─► SSE ─► Portal
                                    │
                                    └─ on job.completed/failed: validate /out ─► commit / PR in document repo ─► remove container
```

1. A user clicks "Assess". The API enqueues a pg-boss job.
2. The worker fetches the latest commits of the relevant code repos and the document repo, then prepares a checkout directory for the job.
3. The worker resolves the inputs:
   - the pipeline stage being run, and the agent definition it names (supplied whole in the `JobSpec`);
   - the agent's bound provider/model;
   - the document repo at the fetched commit (`standards/` and the artifacts the stage reads), which the worker turns into the job's read-only paths and task prompt (the runtime contract knows no project concepts).

   The worker then starts `kintsugi-runner` through the Docker API. Container settings:
   - mounts: `/src` read-only, `/out` writable;
   - environment: only the credentials of the LLM provider in use, plus a short-lived job token;
   - network: internal `jobs` network, which reaches only `kintsugi-app` and `egress-proxy`.
4. The runner creates a locked-down pi session through the SDK (`createAgentSession`, only the agent's allowlisted kernel tools, system prompt = the agent's instructions and skills). Each event goes `POST /internal/jobs/:id/events` → Postgres → `NOTIFY` → SSE to the portal.
5. The agent reads source files directly in `/src` with the kernel file tools (`read`, `ls`, `grep`, `find`) and writes outputs to `/out` with `outputs_write`. The run stops with `job.failed` on an LLM error, abort, timeout, or exceeded `maxTurns` / `maxCostUsd`.
6. When the job ends (`job.completed` or `job.failed`), the worker reads `/out`, validates it (allowed paths, size, secret scan), commits or opens a PR in the document repo ([ADR-0019](../decisions/0019-workspace-repo-write-path.md)), and removes the container.

## 6.2 Project build

1. **Create / join / copy-from.** An admin or architect creates the project in the portal.
   - The worker scaffolds the document repo from `templates/document-repo/` (or reads an existing `kintsugi.yaml`).
   - It registers the AS-IS (`legacy`, `legacy-data`) and TO-BE (`target`) repos per application, then commits through a PR. That PR is gate G0.
2. **Standards.** The team writes `standards/` and `plugins/` through normal PRs, helped by `knowledge-ingest` dry runs and `to-be-analyst`. Plugins are validated after each merge.
3. **Pilot.** Pilot units run through task-planner → member → gate-reviewer (→ compare). The team fixes the standards where results were wrong; the architect then approves gate G3.

Guide: [build a project](../guides/build-project.md).

## 6.3 Work item loop (member + harness)

1. `task-planner` produces the task pack. The worker commits `tasks/<id>.md` and sets the unit file's `stage` / `status` in the document repo.
2. The member runs `kintsugi task start <id>` (or MCP `task.next`).
   - Kintsugi claims the unit: it sets `assignee`, `harness` and `status: in-progress` through the API, committed as `kintsugi-bot` with `Kintsugi-Actor`.
   - The member works with the task pack and the project plugins installed in their harness (built-in `kintsugi` + stack plugins from the project marketplace).
3. The member works in Claude Code / Copilot / ChatGPT-Codex:
   - queries the KB through MCP;
   - commits code to the target repo;
   - commits deliverables to the document repo;
   - opens PRs;
   - registers artifacts with `artifact.register`.
4. The worker detects the PR (webhook or polling) and sets the unit to `awaiting-review`. It then runs a `gate-reviewer` job, which posts PR comments and writes a review record.
5. A human approves and merges. The approval is recorded in the unit file's `gates`. Git sync triggers `knowledge-ingest` to enrich the TO-BE KB, and Monitoring updates the AI metrics.

Step-by-step instructions for members: [member workflow guide](../guides/member-workflow.md).

## 6.4 KB question & answer

Questions come from the portal chat or from a member's harness (MCP `kb.ask`).
1. `kb-assistant` runs as an interactive runtime job; follow-up messages are passed with `followUp`.
2. It answers with citations (`repo@commit:path`, `path:line`).

## 6.5 Git sync and change detection

1. Per repository, the worker keeps the last seen commit (`GitSyncState`).
2. **Detecting changes**:
   - Polling (default, every `KINTSUGI_GIT_POLL_INTERVAL` seconds) fetches each repo and compares heads.
   - When the Git server can reach the installation, provider webhooks trigger the same sync immediately.
3. **Reacting to changes**:
   - New commits on tracked branches enqueue `knowledge-ingest` (incremental).
   - Changes under `plugins/` re-validate the plugins and regenerate the marketplace files.
   - New or updated PRs enqueue `gate-reviewer`.
   - Servers without a provider adapter get sync and branch polling only.
