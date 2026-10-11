# 6. Runtime view

Some runtime agents named on this page (`assessment`, `task-planner`, `gate-reviewer`, …) predate the built-in set of [ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md) (`legacy-analyst`, `business-rules-extractor`, `version-delta-analyst`, `architecture-critic`, `security-auditor`) and describe intent. Every agent is an agent definition supplied per job to the generic runtime kernel ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)).

## 6.1 A runtime job (example: the `assess` stage)

```
User ─► API ─ workflow.job_run (queued) + pg-boss `job-run` ─► Worker
                                                                │
   job workspace <data>/jobs/<id>/ ◄─ fetch mirror, worktree at the commit (read-only) ─┘
     src (ro) · in (ro) · out (rw) · tmp (rw, deleted)
                                                                │
   per step (child run):                                        │
     script step ─► python3 -I / node --permission, cleared env, timeout, output cap, tree kill
     agent job   ─► child process (node --permission, cleared env + provider env, timeout, tree kill):
                    kernel (pi): read under src/in, outputs_write under out ─► LLM provider
     then: out/restricted/ ─► governance.restricted_record (encrypted) · JobOutput hook over out/ · artifact index
                                                                │
   stage done ─► document write of out/ (queue `document-write`) ─► commit / PR in the document repo
                                                                └─► out/ deleted once the write landed
   every step ─► workflow.job_event ─► API (SSE) ─► live log in the portal · cancel ─► worker kills the processes
```

1. A user clicks **Run assess** on an application. The API checks that the application has a legacy repository and the project a document repository, records a `stage` run in `workflow.job_run` as `queued` and enqueues it on `job-run` ([job runs](../reference/data-model.md#job-runs)).
2. The worker fetches the legacy repository's mirror, records the commit of its default branch on the run, and checks that commit out as a detached worktree under `<data>/jobs/<id>/src`, marked read-only. Nothing runs in an OS sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): the job workspace is the boundary.
3. The stage runs its steps in order, each as a child run with its own `in`, `out` and `tmp`, sharing the stage's `src`. Every step sees the earlier steps' outputs and its declared document-repo files (for `assess`: `kintsugi.yaml`, `assessment/<app>/INTENT.md`) under `in`, read-only.
   - **Script step** `scripts/inventory.py` writes `assessment/<app>/inventory.json`: Python in isolated mode with explicit path arguments, a cleared environment (no credentials, no Kintsugi tokens; `HOME` and `TEMP` point into `tmp`), a wall-clock timeout and an output-size cap; on a breach or abort the whole process tree is killed. The script's sha256 is recorded.
   - **Agent job** `legacy-analyst` writes the `assessment/<app>/ASSESSMENT.md` draft. The worker builds the `JobSpec` from the built-in agent definition and the agent's model binding and starts the job as a **child process** of the worker (`services/runtime` `bin/agent-job.js`; pi, or the mock backend without an LLM) with `cwd` = the job directory, the cleared script environment, Node's permission model (reads: the runtime's code and the workspace; writes: `out` and `tmp`; no child processes), a wall-clock timeout and a process-tree kill. The worker decrypts the provider's credentials per job and hands them to that child only: the `JobSpec`, API key and inline secrets on stdin, environment credentials (cloud regions, keys read from variables) in its environment; nothing is written to disk and concurrent jobs share nothing. The child streams `JobEvent`s back as JSON lines. The kernel lets the agent read only under `src` and `in` and write only under `out`. A credential inventory goes to `restricted/SECRETS.local.md`.
4. After every step: files under `out/restricted/` are stored encrypted as restricted records and removed; the JobOutput hook (`hooks/job_output.py`, run like a script step) checks `out/` and fails the step on any credential-shaped value or malformed artifact, with a reason built from its redacted report; the remaining files are indexed in `workflow.artifact` with their provenance. The step's output is merged into the stage's `out`.
5. When every step succeeded, the stage's `out/` is checked once more and handed to the document repo writer (`outputOfJob`, trailers `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Actor`); the run records the document write ([6.6](#66-writing-to-the-document-repo)). `src`, `in` and `tmp` are removed; `out` stays for the writer and is deleted once the write is `committed`, `pr-opened` or `unchanged`. Outputs of failed or cancelled runs and of failed writes are kept for `KINTSUGI_JOB_RETENTION_DAYS` (default 7) and then removed by the worker's hourly sweep ([configuration](../reference/configuration.md)).
6. A failing step fails the stage with a redacted reason and nothing is written. The project page shows each application's runs: status, failure reason, steps, artifacts and the pull request.
7. While it runs, the worker records the run's **events** in `workflow.job_event`: status changes, steps started and finished, agent tool calls (tool and workspace path only, never content) and workflow log lines, all redacted. The portal follows an open run over Server-Sent Events (`GET /api/projects/:id/job-runs/:runId/events`, authenticated by the session cookie, resumable with `Last-Event-ID`) and shows a live log.
8. **Cancel** (`POST …/job-runs/:runId/cancel`, `jobs.run`): a queued run is marked `cancelled` at once and never starts; for a running run the API records a cancel request, the worker running it notices within seconds, kills the running script or agent process tree, and records the step and the run as `cancelled`. Nothing is published.
9. Reading a run's restricted records (`restricted.read`) appends one entry per record to the audit log `governance.audit_event` — who, when, the job run and the path, never the content — before anything is returned.

Workflows (`builtin/workflows/*.js`) run the same way: the orchestrator evaluates the workflow body with injected `args`, `log`, `agent`, `parallel`, `pipeline`, `phase` and `budget`; each `agent(...)` call is an agent job run as a child run, within the workflow's agent cap and concurrency. Workflow code is loaded only from the built-in content, never from a repository.

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

## 6.6 Writing to the document repo

```
Caller (API, job completion) ─► workflow.document_write (queued) + pg-boss `document-write` (key: document repo)
                                   │
                                   ▼
Worker writer ─ fetch mirror ─ validate files ─┬─ autoCommitPaths ─► commit on default branch ─► push
                                               └─ other paths ─────► commit on kintsugi/<agent-or-actor>/<job-id> ─► push ─► open PR
                                   │
                                   └─► workflow.document_write: committed / pr-opened / unchanged / failed
```

1. A caller enqueues a write: the files (inline, or a finished job's `/out`), a message and provenance. Example: **Publish kintsugi.yaml** on the project page.
2. The writer takes one write per document repository at a time, fetches the repository's mirror and validates the files against the output rules.
3. It splits the paths by `autoCommitPaths` from `kintsugi.yaml` on the default branch, and commits each part as `kintsugi-bot` with trailers, in a scratch worktree of the mirror.
4. Each push is fast-forward only. A rejection means someone pushed first: the writer fetches, rebases and retries; a conflict fails the write.
5. For the `kintsugi/*` branch it opens a pull request through the server's REST API; servers without one keep the branch.
6. The outcome is recorded on the write and shown on the project page ([document repository](../reference/document-repo.md#write-path)).
