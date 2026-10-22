# ADR-0055: One durable workspace per job, with the repositories as they are and as they will be

- Status: Accepted (amends 0029, 0052; supersedes the retry-by-copy of 0033). Implemented (see Rollout and Implementation notes)
- Date: 2026-10-22
- Decision register: D71

## Context

[ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md) gave every runtime job a directory, `<data>/jobs/<id>/`, with `src/` (read-only worktrees, [ADR-0052](0052-several-legacy-repositories-per-application.md): one folder per legacy repository), `in/` (declared documents copied from the document repo, read-only), `out/` (results) and `tmp/` (scratch). A stage adds `work/` for what its steps pass to each other. Three things in that design work against long, retried jobs:

1. **The workspace is torn down when the run ends.** The `finally` of `JobRunner.run` always removes `tmp/`, `in/` and `src/`; only `out/` (and `work/` of a failed stage) stays. A retry is a new job: `#resume` copies `out/` and `work/` of the failed job into the new job's directory, checks every repository out again, copies the documents in again and walks the whole tree to mark it read-only again.
2. **What a retry can reuse is one whole step.** A resume skips agent and workflow leaves that succeeded (`stepKey`). A step that failed after 400 tool calls starts over; a step whose prompt or inputs changed is still skipped if its key matches, because nothing records what it was run with.
3. **The agent is told its surroundings piecemeal.** It learns the layout from absolute `{src}`, `{in}` and `{out}` paths spliced into each prompt. Nothing at the root of the workspace says what is where, which repository is which, what was already done, or what the last attempt left behind. A live `assess` run of an application with two repositories showed the effect: the agents spent about 72 % of their reads on one repository, and the front-end repository was read lightly.

The target repositories are not available to a runtime job at all, although a design review or a fidelity check needs the code that implements a design. [ADR-0014](0014-no-code-graph-no-agent-config.md) and AGENTS.md still hold: runtime jobs never write to project repositories; implementation belongs to members.

## Decision

**1. A job has one workspace, named by its job id, that outlives its attempts.** The root stays `<data>/jobs/<job id>/` (not `workspaces/`: `<data>/git/workspaces/` is the document writer's scratch). The agents' working directory (`cwd`) is that root, and the paths they are given are relative to it. The names of the placeholders stay (`{src}`, `{in}`, `{out}`, `{tmp}`, `{sources}`, `{app}`) so that no plan has to be rewritten; their values become relative paths, and `{tobe}` is new.

```
<data>/jobs/<job id>/
  WORKSPACE.md      guide for the agent, generated (decision 4)
  workspace.json    manifest, written by the worker (decision 3)
  as-is/<repo id>/  legacy repositories, read-only worktrees at their pinned commits (was src/)
  to-be/<repo id>/  target repositories, read-only worktrees at their pinned commits (new)
  docs/             the declared documents of the document repo at its pinned commit, read-only (was in/)
  out/              the results, laid out like the document repo; the writer copies it (unchanged)
  work/             what steps pass to each other (unchanged, scratch/<app>/ included); kept between attempts
  steps/<step>/     one folder per step of a stage: in/ (a read-only view of docs, work and out so far), out/, tmp/
  .state/           the ledger; written by the worker only
  tmp/              scratch of one attempt; HOME, TEMP, TMPDIR point here; emptied when an attempt ends
```

A step does not write straight into `out/`: it writes into its own `steps/<step>/out/` and the worker merges that into the stage's `out/` (or `work/`) when the step succeeds. That keeps what a failed step wrote out of the results, lets the members of a group run side by side, and keeps the per-step checks (the JobOutput hook, restricted records, the artifact index). The folder of a step is named by its key in the plan, which is the same in every attempt; an agent step that fails keeps its `out/` there for its next try (decision 6). Before, a step ran in a workspace of its own under a fresh id, with a copy of its inputs made inside it; now its folder is in the job's workspace and the paths in its task do not change from one attempt to the next.

**2. The repositories are mounted by role.** `legacy` repositories go to `as-is/<repo id>/` as ADR-0052 mounted them in `src/`: same ids, same pinned commits, same citation `<repo id>/<path>`. `target` repositories (the to-be, one per architecture component) go to `to-be/<repo id>/`, **read-only**, each at the commit of its default branch when the job first runs, pinned in the manifest. A runtime job still writes to no project repository. `legacy-data` stays unmounted (ADR-0052 decision 6). The runtime's `sources` list becomes `[{role, repositoryId, commit}]`; a run recorded without a role reads as `legacy`. Citations never carry the zone folder: `falo-unities/lib/util.c:12`, not `as-is/falo-unities/lib/util.c:12`; a citation that does is resolved as the plugins already resolve a leading `src/` (`Owners.path_of`). A citation into a target repository reads `<repo id>/<path>` as well; repository ids are unique across roles in an application, so the prefix identifies the zone.

**3. The workspace is provisioned, not built.** A provisioner makes the workspace match a manifest and is safe to call again:

- `workspace.json` records the job id, the attempt, the sources `{role, repositoryId, commit, path}`, `documentsCommit`, the declared document paths and the state of the workspace (decision 7). It is written before anything is mounted.
- For each source it checks that the folder is a worktree whose `HEAD` is the pinned commit with a clean `git status --porcelain`; if so it is reused, otherwise the folder is removed and mounted again. Read-only marking is applied when a folder is mounted, not on reuse.
- `docs/` is rebuilt the same way: the declared paths at `documentsCommit`, compared with the files present.
- `WORKSPACE.md` is regenerated on every provision.

What the workspace holds is split by whether it can be made again: **`as-is/`, `to-be/`, `docs/` and `WORKSPACE.md` can** (from the pinned commits in the manifest, in seconds); **`out/`, `work/`, `.state/` and `workspace.json` cannot**. Only the second group has to survive a failure; the first is a cache.

**4. `WORKSPACE.md` is the guide.** It is generated from the manifest and the earlier documents, never written by an agent, and says:

- the layout above and which folders are read-only and which writable (a step's `out/` and `tmp/`);
- a table of the repositories: zone, id, commit, number of files;
- how to cite (`<repo id>/<path>`), where results go, and to write each result to its file when it is finished, not at the end;
- the attempt number, and, from attempt 2, what the previous attempts left: the steps reused, the steps that failed and the files they wrote;

The kernel tells the agent to read it first: the workspace section of its system prompt names the guide when it is among the readable entries and lists the readable locations relative to the working directory. The kernel stays generic (it knows a file called `WORKSPACE.md`, not what is in it). write and edit keep resolving a relative path against the step's output folder, and a search without a path looks in the first readable directory, `as-is/`.

**5. A retry is another attempt of the same job.** `workflow.job_run` gains `attempt` (1 for the first). `POST …/job-runs/:runId/retry` on a failed stage run puts **the same run** back in the queue with `attempt + 1`: its job id, its pinned `sources`, `documentsCommit` and scope do not change, and `inputs.resumeOf` and the copy of `out/` and `work/` are removed. What each attempt did is kept in the run's summary (`attempts: [{n, startedAt, finishedAt, status, reason}]`); events and telemetry spans record the attempt they belong to (a span's own `attempt`, the retries of one agent inside a step, keeps its meaning). A job runs one attempt at a time. `retry` takes `{fresh: true}` to discard `.state/`, `work/`, `out/`, `steps/` and `docs/` and run the pinned sources again from nothing (the worker applies it once per attempt, recorded in the manifest); a run on the repositories' current commits is a new job, started as today. The portal shows the attempts of a job and offers "Retry" and "Retry from scratch".

**6. A step is reused when its fingerprint matches and its outputs are still there.** The worker keeps `.state/ledger.json`: for each leaf step key (`<step id>[#<forEach key>][@<round>]`, as today) its status, the fingerprint it ran with, the attempt, a digest of what it wrote and the files it wrote (`{path, zone}`), and the choices taken at the gates. The fingerprint is the sha256 of:

- the definition: the agent (instructions, skills, tools) or the workflow, by content;
- the resolved task: the task after the stage's own placeholders are filled (the paths of the workspace are still placeholders, so the text is the same in every attempt), the arguments and the expected output files;
- the sources and `documentsCommit` of the manifest;
- the **upstream chain**: a hash of everything that came before the step in the plan. Each step adds its fingerprint and, for an agent, the digest of what it wrote (a step that ran again and wrote something else changes the chain even if its own fingerprint did not). The members of a `parallel` or `forEach` group start from the chain before the group and do not see each other; the chain after the group folds them in without regard to their order.

An earlier draft of this decision hashed the files a step reads (`reads` in the plan entry). That cannot work on a retry: the results of the steps that came later in the failed attempt are already in `out/` and `work/`, so the files at the start of a step are not the ones it first saw. The chain depends on the plan, not on the files, and needs no declaration in the plans.

A step is skipped when the ledger holds a success with an equal fingerprint and every file it wrote still exists (not that it is unchanged: a later step may have edited it). Otherwise it runs, and the steps after it are judged on their own fingerprints, which now include the new chain. Editing a prompt, changing a plugin's version or running with different documents therefore re-runs exactly the affected steps, where the step key alone reused them. Script steps are cheap, deterministic and the guard before publication: they run again on every attempt; they contribute their fingerprint to the chain but not the digest of what they wrote, which may carry a timestamp. A group that fails keeps what its members that succeeded wrote, so the next attempt skips them. The unit of reuse inside a `forEach` is the member.

An agent step that fails keeps its `steps/<step>/out/`, minus the files the JobOutput hook flagged. Its next try, in the same attempt (a provider failure) or in the next, gets a continuation note appended to its task: the paths already in its output folder, by name only (it cannot read them), with the instruction to write the files that are missing and to rewrite one only if it is not sure it was finished.

**7. Lifecycle and cleanup.** The workspace is in one state, recorded in the manifest:

| State | Meaning | Rematerializable part | Durable part |
|---|---|---|---|
| `running` | an attempt is running | present | present |
| `parked` | the job failed (it can be retried) or was cancelled | a failed job: dropped after the checkout hours of the sandbox settings (default 24) by the hourly sweep; a cancelled job: dropped when the attempt ends | kept for the retention days of the sandbox settings (default 7) |
| `published` | the attempt ended well and the output went to the document repo writer | dropped when the attempt ends | `out/` kept until the write is final (ADR-0029), then the workspace is removed |
| `pruned` | removed | – | – |

The worker always removes `tmp/` when an attempt ends. A successful attempt drops the checkouts at once (they can be made again, and nothing else reads them). Mounted worktrees are released from their mirrors with the folder (`release`), so no mirror keeps a worktree record of a removed workspace; the sweep also prunes such records. A retry of a `parked` job provisions what was dropped, so a job retried after a week still resumes if its durable part is within retention.

**8. The reads per repository are not measured.** An earlier draft added up the reads of the agents per repository from their tool-call events and showed them in the run detail and in the guide. It was dropped: the guide already tells the agent which repositories there are and where, and whether that is enough to read them evenly is judged from the results (the report names a repository nobody read, as ADR-0052 decision 5 has it).

**9. Confinement follows the zones.** The kernel's read tools are confined to the entries of `workspace.readOnly` (`as-is/`, `to-be/`, the step's `in/` and `WORKSPACE.md`, whose first entry is a directory), the output tools to the step's `out/`; `workspace.root` is the working directory. `.state/`, `workspace.json` and the other steps' folders are out of reach of the tools (the path guard has no entry for them). The child process is given read access to the root as a whole (Node's permission model refuses even a `stat` of a parent of an allowed folder, so the child's own check of the job and pi's working directory would fail otherwise); the kernel's guard, not the process, decides which of it a tool reaches. The shell and git tools of ADR-0040 start in the root and keep their own confinement. The child process's Node permission model reads the runtime code and the workspace root and writes the step's `out/` and `tmp/`; the ledger and the manifest are written by the worker, which also runs the JobOutput hook as before. Everything else in ADR-0029 (cleared environment, no credentials, limits, process-tree kill, no OS isolation) is unchanged.

**10. The sandbox environment is set in the portal.** The settings of the environment a job runs in are an installation setting, `sandbox` in `admin.installation_setting`, edited in Settings → Sandbox (permission `sandbox.manage`) and read by the worker when a job starts and in each sweep, so a change applies to the next job without a restart; an invalid or missing field is its default. They are: the hours a failed job keeps its checkouts (24) and the days it keeps its results (7); the timeout of a script step (10 minutes) and of an agent job (none); the idle limit of an agent job (5 minutes; 0 turns the watchdog off); the output a step may write (50 MB); the turns (none) and the cost (none) of an agent job; and whether the checkouts and the inputs are marked read-only on disk (on). They replace the environment variables `KINTSUGI_JOB_DEFAULT_TIMEOUT`, `KINTSUGI_AGENT_IDLE_TIMEOUT`, `KINTSUGI_SCRIPT_TIMEOUT`, `KINTSUGI_JOB_MAX_OUTPUT_BYTES`, `KINTSUGI_JOB_MAX_TURNS`, `KINTSUGI_JOB_MAX_COST_USD` and `KINTSUGI_JOB_RETENTION_DAYS`, which are no longer read: installation settings that an administrator changes belong in the portal ([AGENTS.md](../../AGENTS.md)), and the deployment keeps what is about the deployment (the data directory, the concurrency of the worker, the budgets of stages and workflows, the interpreters). The idle limit travels with the job (`limits.idleTimeoutSec`). Switching the read-only marking off leaves the kernel's path guard as the only confinement of an agent, which is what the guard is for; a script or the `shell` tool of an agent could then write into a checkout, the one place where the marking is more than defence in depth.

## Consequences

- **A retry continues where the job stopped.** No repository is checked out again while the checkouts are within their hours, and no step whose inputs did not change is run again. A job parked for a few days still keeps its results and rebuilds its checkouts from the pinned commits.
- **A retry of a prompt or a plugin you changed does the right thing**: the fingerprints differ, so the affected steps run again and the rest are reused. Before, the step key alone reused a step that had been run with the old prompt.
- **Agents start from a guide.** Prompts shrink (relative paths, one sentence for the layout), transcripts hold no data-directory path, and the agent can see what an earlier attempt left.
- **Reviews and fidelity checks can read the to-be**, without any runtime job gaining write access to a project repository.
- **Cost: disk.** Checkouts stay for hours after a failure. They are cheap to share (worktrees of a mirror) and the sweep bounds them; a large estate with many failed jobs should lower the checkout hours in Settings → Sandbox.
- **Cost: model change.** `attempt` on the job run, an `attempts` summary, the ledger and the manifest are new; the retry API returns the same run instead of a new one, and anything that held a retry's id (links to `resumeOf` in the portal and in the audit) changes. No application has run Kintsugi against the old model, so nothing is kept for compatibility.
- **Cost: path rename.** `src/` becomes `as-is/` and `in/` becomes `docs/`. The placeholders keep their names, which limits the change to the worker, the kernel, the agents' prompts and workflows that name `src/`, the tolerated prefix of a citation (`Owners.path_of`) and the tests. Nothing of the old layout is read: a workspace made before has no manifest and is removed by the sweep.
- **Risk.** A fingerprint that misses an input reuses a stale step. The chain (everything before the step in the plan counts) and the `fresh` retry bound it; a workflow's fingerprint covers the workflow, not the agents it calls. The ledger and the worktrees are state the worker must keep consistent; the provisioner verifies them instead of trusting them.
- **Windows.** Read-only marking is still advisory on directories (ADR-0029); reuse avoids the repeated walk that marks it.

## Alternatives considered

- **A new job per retry, as before, with copying.** Works, but copies the durable part and rebuilds the rest every time, leaves two job ids to relate, and cannot say why a step was or was not reused. Rejected.
- **A workspace per application and stage, shared by all its jobs.** The most reuse, but concurrent jobs on one application (an `assess` while a design run is going) would write to the same `out/` and `work/`. A job id is the boundary an audit, a cancel and a cleanup already have. Rejected; sharing happens through the mirrors.
- **Mounting the to-be writable, with the changes returned as a pull request.** That would make a runtime job an implementer and contradict ADR-0014 and the member harness model. Rejected here; it needs its own decision if it is ever wanted.
- **Copying the repositories instead of worktrees, or archives without `.git`.** A copy costs the size of the repository per job; an archive hides history from the git tool of ADR-0040. Rejected.
- **Persisting the pi session to resume inside an agent.** Ties resume to one provider and one library version, and the transcript is not the work. The work products on disk and a continuation note carry the same information. Rejected.

## Rollout

Implemented in one change, without a compatibility path for the old layout: `packages/git` (the layout, `worktreeIsAt`), `packages/domain` (source roles, sandbox settings), `packages/runtime-sdk` and `services/runtime` (the workspace root, the guide, the idle limit), `services/orchestrator` (`src/workspace/`, the runner, the executor, the cleanup, the sandbox provider), `apps/api` (migrations 023 and 024, the retry endpoint, the sandbox endpoints), `apps/portal` (attempts, Retry and Retry from scratch, Settings → Sandbox), the plugins' prompts and the documentation ([job workspace](../reference/job-workspace.md)).

## Implementation notes

- The ledger fingerprints a step with the chain of the plan, not with the files it read (decision 6).
- A target repository that cannot be resolved or mounted is left out of the job with a line in the log; only a legacy repository fails it.
- `restricted/` is not a folder of the workspace: `out/restricted/` is stored and removed at the end of each step, as before.
- The main languages of a repository are not in the guide: the guide lists the files of each checkout, and the inventory (a document of the job) has the languages.
