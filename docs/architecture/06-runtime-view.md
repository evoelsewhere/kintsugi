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

1. A user clicks **Run assess** on an application. The API checks that the application has a legacy repository, the project a document repository, that no run of the stage is queued or running for the application and that the stages it reads have succeeded ([stage plans](#stage-plans)); it records a `stage` run in `workflow.job_run` as `queued` and enqueues it on `job-run` ([job runs](../reference/data-model.md#job-runs)).
2. The worker fetches the legacy repository's mirror, records the commit of its default branch on the run, and checks that commit out as a detached worktree under `<data>/jobs/<id>/src`, marked read-only. Nothing runs in an OS sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): the job workspace is the boundary.
3. The stage runs its plan's steps ([stage plans](#stage-plans)), each as a child run with its own `in`, `out` and `tmp`, sharing the stage's `src`. Every step sees the declared document-repo files (for `assess`: `kintsugi.yaml`, `standards/`, `assessment/<app>/INTENT.md`, `assessment/<app>/telemetry/`) and the earlier steps' outputs under `in`, read-only.
   - **Script step** `scripts/inventory.py` writes `assessment/<app>/inventory.json`: Python in isolated mode with explicit path arguments, a cleared environment (no credentials, no Kintsugi tokens; `HOME` and `TEMP` point into `tmp`), a wall-clock timeout and an output-size cap; on a breach or abort the whole process tree is killed. The script's sha256 is recorded.
   - **Agent jobs**: three analysis jobs in parallel (`legacy-analyst` structure and debt, `security-auditor` scan) write intermediate notes; a `legacy-analyst` synthesis job writes `assessment/<app>/ASSESSMENT.md` and `ARCHITECTURE.mmd`. The worker builds the `JobSpec` from the built-in agent definition and the agent's model binding and starts the job as a **child process** of the worker (`services/runtime` `bin/agent-job.js`; pi, or the mock backend without an LLM) with `cwd` = the job directory, the cleared script environment, Node's permission model (reads: the runtime's code and the workspace; writes: `out` and `tmp`; no child processes), a wall-clock timeout and a process-tree kill. The worker decrypts the provider's credentials per job and hands them to that child only: the `JobSpec`, API key and inline secrets on stdin, environment credentials (cloud regions, keys read from variables) in its environment; nothing is written to disk and concurrent jobs share nothing. The child streams `JobEvent`s back as JSON lines. The kernel lets the agent read only under `src` and `in` and write only under `out`. A credential inventory goes to `restricted/SECRETS.local.md`.
4. After every step: files under `out/restricted/` are stored encrypted as restricted records and removed; the JobOutput hook (`hooks/job_output.py`, run like a script step) checks `out/` and fails the step on any credential-shaped value or malformed artifact, with a reason built from its redacted report; the remaining files are indexed in `workflow.artifact` with their provenance. The step's output is merged into the stage's `out`.
5. When every step succeeded, the stage's `out/` is checked once more and handed to the document repo writer (`outputOfJob`, trailers `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Actor`); the run records the document write ([6.6](#66-writing-to-the-document-repo)). `src`, `in` and `tmp` are removed; `out` stays for the writer and is deleted once the write is `committed`, `pr-opened` or `unchanged`. Outputs of failed or cancelled runs and of failed writes are kept for `KINTSUGI_JOB_RETENTION_DAYS` (default 7) and then removed by the worker's hourly sweep ([configuration](../reference/configuration.md)).
6. A failing step fails the stage with a redacted reason and nothing is written. The project page shows each application's runs: status, failure reason, steps, artifacts and the pull request.
7. While it runs, the worker records the run's **events** in `workflow.job_event`: status changes, steps started and finished, agent tool calls (tool and workspace path only, never content) and workflow log lines, all redacted. The portal follows an open run over Server-Sent Events (`GET /api/projects/:id/job-runs/:runId/events`, authenticated by the session cookie, resumable with `Last-Event-ID`) and shows a live log.
8. **Cancel** (`POST …/job-runs/:runId/cancel`, `jobs.run`): a queued run is marked `cancelled` at once and never starts; for a running run the API records a cancel request, the worker running it notices within seconds, kills the running script or agent process tree, and records the step and the run as `cancelled`. Nothing is published.
9. Reading a run's restricted records (`restricted.read`) appends one entry per record to the audit log `governance.audit_event` — who, when, the job run and the path, never the content — before anything is returned.

Workflows (`builtin/workflows/*.js`) run the same way: the orchestrator evaluates the workflow body with injected `args`, `log`, `agent`, `parallel`, `pipeline`, `phase` and `budget`; each `agent(...)` call is an agent job run as a child run, within the workflow's agent cap and concurrency. Workflow code is loaded only from the built-in content, never from a repository.

### Stage plans

Every runtime stage the portal can start is a **stage plan**: data in `services/orchestrator/src/jobs/plans/`, run by one generic executor (`jobs/executor.ts`). A plan declares the document-repo files every step sees (`documents`, folders end in `/`), the files an earlier stage must have merged on the document repo's default branch (`requires`), and its steps:

| Step kind | What it does |
| --- | --- |
| `script` | A built-in script, or a model-written one from the inputs (`fromInputs`). Optional `repair`: on failure an agent job gets the error once (`{error}`), then the script runs again; a second failure fails the stage. |
| `agent` | One agent job. Optional `schema` + `resultTo`: a structured result saved as JSON. |
| `workflow` | A built-in workflow; it gets what is left of the stage's agent budget. Optional `resultTo` saves its returned object. |
| `parallel` | Independent steps with the same inputs; outputs merge when all have finished. |
| `forEach` | One agent job per item (`{item}`, `{key}`), bounded concurrency; optionally tolerating failed items. |
| `repeat` | Steps in rounds (`{round}`, `{maxRounds}`) until a condition holds, at most `max` rounds. |
| `gate` | A human decision the command describes. Persisted gates are not wired yet: the default decider takes the documented default at once, the run's live record says `gate defaulted: …` and the stage summary lists it. |

Any step may have a `when` condition (a skipped step is recorded), `expects` (files it must write; a missing one fails it with "did not write …") and `intermediate` (outputs later steps read but the writer never publishes: analysis notes, node packets, a scan result). The stage summary lists every step with its child run, status, round or item, the gates and the agent jobs started. A stage starts at most `KINTSUGI_STAGE_MAX_AGENTS` agent jobs (workflow jobs included) and runs at most `KINTSUGI_STAGE_CONCURRENCY` group members at a time ([configuration](../reference/configuration.md)).

| Stage | Steps | Writes | Gates defaulted |
| --- | --- | --- | --- |
| `assess` | `inventory.py` · in parallel: `legacy-analyst` structure, `legacy-analyst` debt, `security-auditor` scan (intermediate notes) · `legacy-analyst` synthesis | `inventory.json`, `ASSESSMENT.md`, `ARCHITECTURE.mmd`, restricted credential inventory | none |
| `map` | `legacy-analyst` topology job writes `extract_topology.py` · script step runs it (repaired once on failure) · `legacy-analyst` flows · gate · `node_packets.py` · one `legacy-analyst` description job per packet · `merge_topology.py` · `legacy-analyst` diagrams | `extract_topology.py`, `topology.json`, `topology.summary.txt`, three `.mmd` files | more than 40 nodes: describe the 40 largest |
| `extract-rules` | `make_shards.py` · gate · workflow `extract-rules` (module mode, or lens mode on a tiny estate) · `render_rules.py` | `extract-rules.modules.json`, `rules_result.json`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md` | more than 12 shards: run all |
| `harden` | workflow `harden-scan` (intermediate result) · `security-auditor` triage and remediation · up to 3 rounds of `security-auditor` review, each followed by a revision while a hunk is not clean | `SECURITY_FINDINGS.md`, `security_remediation.patch`, restricted credential inventory | none (applying the patch stays a member's decision outside Kintsugi) |

All paths are under `assessment/<app>/`. `map` and `extract-rules` require `assessment/<app>/ASSESSMENT.md`: the API refuses to start them (409) until an `assess` run of the application has succeeded, and the worker fails them before any step when the file is not on the document repo's default branch yet (the assess pull request is not merged). `harden` reads the assessment when it exists. The API also refuses a second run of a stage while one is queued or running for the application. Not wired yet: portfolio mode of `assess`, chunked mapping of big estates and the re-ask of rejected node descriptions, a module pattern, split runs and resume for `extract-rules`, and the coverage-gap re-run of `harden`.

With the mock backend (`KINTSUGI_RUNTIME_MODE=mock`) no agent writes anything, so after each mock agent job the worker fills in what the step expects (a generic topology script, stub documents, schema-shaped structured results) and every later step gets valid inputs.

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
