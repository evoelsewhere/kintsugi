# 6. Runtime view

Some runtime agents named on this page (`assessment`, `task-planner`, `gate-reviewer`, …) predate the built-in set of [ADR-0026](../decisions/0026-runtime-agents-and-agent-builder.md) (`legacy-analyst`, `business-rules-extractor`, `architecture-critic`, `security-auditor`) and describe intent. Every agent is an agent definition supplied per job to the generic runtime kernel ([ADR-0023](../decisions/0023-runtime-as-generic-agent-kernel.md)).

## 6.1 A runtime job (example: the `assess` stage)

```
User ─► API ─ workflow.job_run (queued) + pg-boss `job-run` ─► Worker
                                                                │
   job workspace <data>/jobs/<id>/ ◄─ fetch mirror, worktrees at the pinned commits (read-only) ─┘
     as-is/<repo> (ro) · to-be/<repo> (ro) · docs (ro) · out · work · steps/<step>/{in,out,tmp}
     WORKSPACE.md (guide) · workspace.json (manifest) · .state/ledger.json — kept across attempts
                                                                │
   per step (child run, in steps/<step>/):                      │
     script step ─► python3 -I / node --permission, cleared env, timeout, output cap, tree kill
     agent job   ─► child process (node --permission, cleared env + provider env, timeout, tree kill):
                    kernel (pi): cwd = the workspace, read as-is/to-be/in/guide, write under the step's out ─► LLM provider
     then: out/restricted/ ─► governance.restricted_record (encrypted) · JobOutput hook over out/ · artifact index
                                                                │
   stage done ─► document write of out/ (queue `document-write`) ─► commit / PR in the document repo
                                                                └─► out/ deleted once the write landed
   every step ─► workflow.job_event ─► API (SSE) ─► live log in the portal · cancel ─► worker kills the processes
```

1. A user clicks **Run assess** on an application. The API checks that the application has a legacy repository (it reads every one it has), the project a document repository, that no run of the stage is queued or running for the application and that the stages it reads have succeeded ([stage plans](#stage-plans)); it records a `stage` run in `workflow.job_run` as `queued` and enqueues it on `job-run` ([job runs](../reference/data-model.md#job-runs)).
2. The worker provisions the job's workspace ([job workspace](../reference/job-workspace.md), [ADR-0055](../decisions/0055-one-durable-workspace-per-job.md)): it fetches the mirror of each legacy and target repository, records the commit of each default branch on the run, and checks each commit out as a detached worktree in its own folder, `<data>/jobs/<id>/as-is/<repository id>/` for the legacy code and `to-be/<repository id>/` for the target code, marked read-only ([ADR-0052](../decisions/0052-several-legacy-repositories-per-application.md)). It writes the manifest `workspace.json` and the guide `WORKSPACE.md`. A retry finds all of it still there. Nothing runs in an OS sandbox ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): the job workspace is the boundary.
3. The stage runs its plan's steps ([stage plans](#stage-plans)), each as a child run in its own folder of the workspace, `steps/<step>/{in,out,tmp}`, sharing the stage's `as-is` and `to-be`. Every step sees the declared document-repo files (for `assess`: `kintsugi.yaml`, `01-standards/`, `10-applications/<app>/00-inputs/INTENT.md`, `10-applications/<app>/00-inputs/telemetry/`) and the earlier steps' outputs under its `in`, read-only. Paths in a task are relative to the workspace root, the working directory of every process, so a step has the same text in every attempt.
   - **Script step** `scripts/inventory.py` writes `10-applications/<app>/01-legacy/inventory.md` (and the per-file `inventory.json` in the run's scratch): Python in isolated mode with explicit path arguments, a cleared environment (no credentials, no Kintsugi tokens; `HOME` and `TEMP` point into `tmp`), a wall-clock timeout and an output-size cap; on a breach or abort the whole process tree is killed. The script's sha256 is recorded.
   - **Agent jobs**: three analysis jobs in parallel (`legacy-analyst` structure and debt, `security-auditor` scan) write intermediate notes; a `legacy-analyst` synthesis job writes `10-applications/<app>/01-legacy/assessment.md` and `architecture.mmd`. The worker builds the `JobSpec` from the built-in agent definition and the agent's model binding and starts the job as a **child process** of the worker (`services/runtime` `bin/agent-job.js`; pi, or the mock backend without an LLM) with `cwd` = the step's folder, the cleared script environment, Node's permission model (reads: the runtime's code, the step's folder, the checkouts and the guide; writes: the step's `out` and `tmp`), a wall-clock timeout and a process-tree kill. The worker decrypts the provider's credentials per job and hands them to that child only: the `JobSpec`, API key and inline secrets on stdin, environment credentials (cloud regions, keys read from variables) in its environment; nothing is written to disk and concurrent jobs share nothing. The child streams `JobEvent`s back as JSON lines. The kernel's working directory for the agent is the workspace root: it reads only under `as-is`, `to-be`, the step's `in` and `WORKSPACE.md` (a search without a path looks in `as-is`) and writes only under the step's `out`; it tells the agent to read the guide first. A credential inventory goes to `restricted/SECRETS.local.md`.
4. After every step: files under `out/restricted/` are stored encrypted as restricted records and removed; the JobOutput hook (`hooks/job_output.py`, run like a script step) checks `out/` and fails the step on a malformed artifact (credentials are not scanned or masked), with a reason built from its redacted report (for an agent step the same redacted findings, `rule at path:line`, are first handed back to the agent once to fix in its own `out/`, and the step fails only if the second pass is still flagged); the remaining files are indexed in `workflow.artifact` with their provenance. The step's output is merged into the stage's `out` (or `work`), and its folder is removed; the step that fails keeps its `out` (an agent step) so its next try is told what is in it. The worker records the step in the ledger (`.state/ledger.json`) with a fingerprint of everything it ran with.
5. When every step succeeded, the stage's `out/` is checked once more and handed to the document repo writer (`outputOfJob`, trailers `Kintsugi-Job`, `Kintsugi-Agent`, `Kintsugi-Actor`); the run records the document write ([6.6](#66-writing-to-the-document-repo)). The checkouts, the documents, the steps' folders and `tmp` are removed; `out` stays for the writer and is deleted once the write is `committed`, `pr-opened`, `merged`, `closed` or `unchanged`. A job that failed keeps its workspace: the checkouts for the hours set in Settings → Sandbox (24 by default), its results for the days set there (7 by default), then the worker's hourly sweep removes them ([job workspace](../reference/job-workspace.md)).
6. A failing step fails the stage with a redacted reason and nothing is written. The project page shows each application's runs: status, failure reason, attempts, steps, artifacts and the pull request. **Retry** (`POST …/job-runs/:runId/retry`, `jobs.run`) puts the same run back in the queue as its next attempt, in the same workspace: the steps whose fingerprint is unchanged and whose results are still there are not run again; **Retry from scratch** (`{"fresh": true}`) discards what the job kept and reads the same pinned commits.
7. While it runs, the worker records the run's **events** in `workflow.job_event`: status changes, steps started and finished, agent tool calls (tool and workspace path only, never content), workflow log lines and the attempt each belongs to, all redacted. The portal follows an open run over Server-Sent Events (`GET /api/projects/:id/job-runs/:runId/events`, authenticated by the session cookie, resumable with `Last-Event-ID`) and shows a live log.
   The agent's child also reports **spans** (the job, each model turn, tool call, compaction and retry); the worker stores them in `monitoring.telemetry_span` with the agent, model and attempt, and Governance → Telemetry reads them ([ADR-0048](../decisions/0048-runtime-telemetry-compaction-and-prompt-cache.md)).
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

A plan may also declare `optional` inputs (used when present, the missing ones listed in the summary) and `reviewAll` (every output through the pull request, auto-commit paths included). Any step may have a `when` condition (a skipped step is recorded), `expects` (files it must write; a missing one fails it with "did not write …") and `intermediate` (outputs later steps read but the writer never publishes: analysis notes, node packets, a scan result). The stage summary lists every step with its child run, status, round or item, the gates and the agent jobs started. A stage starts at most `KINTSUGI_STAGE_MAX_AGENTS` agent jobs (workflow jobs included) and runs at most `KINTSUGI_STAGE_CONCURRENCY` group members at a time ([configuration](../reference/configuration.md)).

| Plan / use | Steps | Writes | Gate behavior |
| --- | --- | --- | --- |
| Built-in stage `assess` | Inventory script; parallel analysis jobs; topology extraction; catalog proposal and curation; synthesis | `10-applications/<app>/01-legacy/inventory.md`, `topology.md`, `_catalog/` (an index and a document per module), `assessment.md`, `architecture.mmd`, and `_tools/extract_topology.py`; scratch under `scratch/<app>/` is never committed ([ADR-0042](../decisions/0042-markdown-only-document-repo-by-bounded-context.md)) | No separate `map` stage; its topology work is part of `assess` |
| Built-in stage `understand` | Runs on a selected catalog scope; per-unit topology, rule and finding extraction; AS-IS specification and unit-state proposal | Per-unit documents under `10-applications/<app>/01-legacy/<module>/<unit>/` (`topology.md`, `rules.md` and `rules/<rule id>.md`, `data-objects.md`, `findings.md`, the specification `spec.md`, `trace.md`, and the provenance record `understanding.md`), and state in the unit's card `10-applications/<app>/02-modern/<module>/<unit>/README.md` | `reviewAll`: selected unit outputs go through one pull request |
| Internal post-merge plan `rebuild` | Runs `rebuild_aggregates.py` from merged per-unit outputs | `10-applications/<app>/_generated/{BUSINESS_RULES.md,DATA_ACCESS.md,DATA_OBJECTS.md,GAPS.md,SECURITY_FINDINGS.md,traceability.md,README.md}` | Aggregate paths are auto-committed after merge |
| Shared topology helper | `topology.ts` shares topology extraction with the built-in plans | the raw `topology.json` in the run's scratch, summarised by `render_topology.py` into `10-applications/<app>/01-legacy/topology.md`; the extraction script is at `10-applications/<app>/01-legacy/_tools/extract_topology.py` | Helper, not a separate stage id |

The current built-in assessment plans are `assess` and `understand`; `map`, `extract-rules` and `harden` are not independent plan ids. Their topology, rule-extraction and security-review responsibilities are handled within the current plans ([ADR-0033](../decisions/0033-assess-catalog-understand-selection.md)). `understand` consumes the catalog `10-applications/<app>/01-legacy/_catalog/` and writes only selected units' paths through `reviewAll`; it does not write whole-application files at the root of `10-applications/<app>/01-legacy/`. After those per-unit files merge, `rebuild` regenerates the application aggregates listed above. The API derives item status from catalog and run files; it does not store progress separately. See the [document repo layout](../reference/document-repo.md) and [item catalog](../reference/document-repo-item-catalog.md) for current paths and semantics.

With the mock backend (`KINTSUGI_RUNTIME_MODE=mock`) no agent writes anything, so after each mock agent job the worker fills in what the step expects (a generic topology script, stub documents, schema-shaped structured results) and every later step gets valid inputs.

## 6.2 Project build

1. **Create / join / copy-from.** An admin or architect creates the project and registers its application/repository records in the portal; the portal renders `kintsugi.yaml`. **Publish kintsugi.yaml** proposes it, together with the starter structure of `templates/document-repo/` for everything the document repo lacks (create-only files, one skeleton per application), as one pull request from `kintsugi/<user>/<write-id>`; that PR is gate G0. Joining an existing repo by reading its `kintsugi.yaml` remains planned (see [Build a project](../guides/build-project.md)).
2. **Standards.** The team writes `01-standards/` and `plugins/` through normal PRs, helped by `knowledge-ingest` dry runs and `to-be-analyst`. Plugins are validated after each merge.
3. **Pilot.** Pilot units run through task-planner → member → gate-reviewer (→ compare). The team fixes the standards where results were wrong; the architect then approves gate G3.

Guide: [build a project](../guides/build-project.md).

## 6.3 Unit loop (member + harness)

1. `task-planner` produces the unit's task pack. The worker commits `tasks/<id>.md` and sets the unit file's `stage` / `status` in the document repo.
2. The member runs `kintsugi task start <id>` (or MCP `task.next`).
   - Kintsugi claims the unit: it sets `assignee`, `harness` and `status: in-progress` through the API, committed as `kintsugi-bot` with `Kintsugi-Actor`.
   - The member works with the task pack and project-authored plugin sources in `plugins/`; generation of the built-in `plugins/kintsugi/`, marketplace files and harness fallback renderings is planned but not implemented.
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
   - Changes under `plugins/` are revalidated; generation of `plugins/kintsugi/`, marketplace files and harness fallback renderings is planned but not implemented.
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
                                      └─ review watch: pr-opened / committed(branch) ─► merged / closed
```

1. A caller enqueues a write: the files (inline, or a finished job's `/out`), a message and provenance. Example: **Publish kintsugi.yaml** on the project page.
2. The writer takes one write per document repository at a time, fetches the repository's mirror and validates the files against the output rules.
3. It splits the paths by `autoCommitPaths` from `kintsugi.yaml` on the default branch, and commits each part as `kintsugi-bot` with trailers, in a scratch worktree of the mirror.
4. Each push is fast-forward only. A rejection means someone pushed first: the writer fetches, rebases and retries; a conflict fails the write.
5. For the `kintsugi/*` branch it opens a pull request through the server's REST API; servers without one keep the branch.
6. The outcome is recorded on the write and shown on the project page ([document repository](../reference/document-repo-write-path.md)).

## 6.7 Worker heartbeat

```
Worker (every 15 s) ─► upsert workflow.worker_heartbeat (host, pid, version, active jobs, queues, last_seen_at = now())
Worker (shutdown)   ─► queues drained gracefully ─► stopped_at = now()
API  ─► GET /api/monitoring/workers · GET /api/monitoring/overview (worker.up, worker-down attention item)
```

1. On start, the worker removes heartbeat rows not seen for 7 days and writes its own row (a random id per process). It repeats the upsert every 15 seconds with the number of jobs in progress (job runs, document writes, Git syncs) and the queues it works ([ADR-0030](../decisions/0030-worker-heartbeat-in-postgres.md)).
2. A failed beat is logged and retried at the next tick; it never stops the worker.
3. On `SIGINT` or `SIGTERM` the worker stops its queues gracefully, then marks its row stopped. A crashed or killed worker simply stops being seen.
4. The API judges each row by the database clock: **up** when seen less than 45 seconds ago (three missed beats), **stopped** after a clean shutdown, **stale** otherwise. The overview reports whether any worker is up; when none is, *No worker is running* tops what needs attention. Monitoring → Worker lists every worker.

## 6.8 Gates

```
Person (gates.request) ─► POST /api/governance/gates ─┐
Stage plan (worker)    ─► requestGate() ──────────────┴─► governance.gate (pending) + audit gate.request
                                                              │
Person (gates.decide)  ─► POST …/:id/decision {approve|reject|waive, note} ─► approved / rejected / waived + audit gate.decide
Stage plan (worker)    ─► waitForGate() polls the row ─► acts on the decision
```

1. A gate is opened for a project (optionally an application) and a key: a pipeline gate `G0`–`G4` or a stage gate `stage:<id>`, with what it is about (for example the job run that reached it). While it is pending, asking again returns the open gate, so the worker can request it idempotently ([gates](../reference/data-model.md#gates)).
2. Pending gates show on the overview and in Governance → Gates. A holder of `gates.decide` approves, rejects or waives the gate; rejecting or waiving needs a note. The decision is final and audited.
3. The worker's helpers (`services/orchestrator/src/gates.ts`) use the database only: a stage plan requests the gate, polls its state and acts on the decision. Asking again after a decision opens a new gate; the rows of one key are its history.
