# Job workspace

A runtime job runs in a **job workspace**, `<KINTSUGI_DATA_DIR>/jobs/<job id>/`: one per job, named by the job's id and kept across its attempts ([ADR-0055](../decisions/0055-one-durable-workspace-per-job.md), on [ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)). It is the isolation boundary of runtime jobs and script steps; there is no OS-level sandbox. The agent's working directory is the workspace root, and every path in its task is relative to it.

## Layout

```
<data>/jobs/<job id>/
  WORKSPACE.md      the guide for the agent, generated at the start of every attempt
  workspace.json    the manifest, written by the worker
  as-is/<repo>/     the legacy repositories, read-only worktrees at their pinned commits
  to-be/<repo>/     the target repositories (the to-be), read-only worktrees at their pinned commits
  docs/             the declared documents of the document repo at its pinned commit, read-only
  out/              the results, laid out like the document repo; the writer copies it
  work/             what the steps of a stage pass to each other (intermediate, never published)
  steps/<step>/     one folder per step of a stage: in/ (a read-only view of docs, work and out so far), out/, tmp/
  .state/           the ledger of finished steps; written by the worker only
  tmp/              scratch of one attempt; HOME, TEMP and TMPDIR of the job's processes
```

A step's folder is named after its key in the plan (`<step id>[#<item>][@<round>]`, made safe for a file name and unique). A step of a workflow's agent call has a folder named by its run id.

| Zone | Agent | Script step |
|---|---|---|
| `as-is/`, `to-be/`, the step's `in/`, `WORKSPACE.md` | read | read |
| the step's `out/` | write (by a path relative to it), not readable | write |
| the step's `tmp/` | process scratch | write |
| `.state/`, `workspace.json`, the other steps' folders | out of reach for the kernel's tools | out of reach |

A search without a path (`ls`, `grep`, `find`) looks in `as-is/`, so a hit reads as a citation: `<repository id>/<path>`. **Citations never carry the zone folder** ([ADR-0052](../decisions/0052-several-legacy-repositories-per-application.md)); a citation that does is resolved all the same.

## Placeholders

The placeholders of a task or a script's arguments are filled with paths relative to the workspace root, so a step has the same text in every attempt:

| Placeholder | Value |
|---|---|
| `{src}` | `as-is` |
| `{tobe}` | `to-be` |
| `{in}` | `steps/<step>/in` (`docs` for a job that is not a stage) |
| `{out}` | `steps/<step>/out` (`out` for a job that is not a stage) |
| `{tmp}` | `steps/<step>/tmp` (`tmp` for a job that is not a stage) |
| `{sources}` | the legacy repositories and their commits, `id@commit,id@commit` |
| `{app}`, `{run}`, `{item}`, `{key}`, `{round}`, `{maxRounds}`, `{error}` | as in the [stage plans](../architecture/06-runtime-view.md#stage-plans) |

## The manifest

`workspace.json` says what the workspace was built for: the job id, the attempt that last ran in it, its state, every source with its role (`legacy` or `target`) and pinned commit, and the commit of the document repo `docs/` was built for. It is written before anything is mounted. A **target repository that cannot be read** (empty, not synced yet, gone) is left out with a line in the log; a legacy one fails the job.

| State | Meaning |
|---|---|
| `running` | an attempt is running |
| `parked` | the job failed or was cancelled |
| `published` | the attempt ended well; only `out/` is still needed, for the document write |

## Provisioning

The worker makes the workspace match the manifest, and can do it again: a checkout that is still the pinned commit with nothing changed (`git status` clean) is kept; any other folder is removed and checked out again. The documents are rebuilt only when the document-repo commit changed. What can be made again from the pins (`as-is/`, `to-be/`, `docs/`, `WORKSPACE.md`) is a cache; what cannot (`out/`, `work/`, `.state/`, `workspace.json`) is never touched.

## The guide

`WORKSPACE.md` is generated from the manifest and the ledger, never written by an agent; the kernel tells every agent to read it first. It has the layout and the access rules, a table of the repositories (zone, id, commit, number of files), how to cite, the working rules (write each result as soon as it is finished), and from the second attempt what the earlier attempts left.

## Attempts, the ledger and reuse

A retry of a failed stage run puts **the same run** back in the queue as its next attempt (`workflow.job_run.attempt`, history in `attempts`). The worker records every leaf step of the plan in `.state/ledger.json`: its status, the **fingerprint** it ran with and what it wrote.

A step is skipped when the ledger holds a success with an equal fingerprint and every file it wrote is still there. The fingerprint is the hash of:

- the **definition**: the agent (instructions, skills, tools) or the workflow, by content;
- the **task** as the stage filled it, the arguments and the expected files;
- the pinned **sources** and **documents**;
- the **upstream chain**: a hash of every step that came before it in the plan, each contributing its fingerprint and, for an agent, the digest of what it wrote. A change anywhere upstream re-runs what follows. The members of a `parallel` or `forEach` group do not depend on each other.

Script steps always run again (they are cheap, deterministic and the guard before publication) and contribute their fingerprint only, since what they wrote may carry a timestamp. A group that fails keeps what its members that succeeded wrote. An agent step that fails keeps its output folder, and its next try is told which files are in it (names only: it cannot read them) and to write the missing ones. Files the JobOutput hook flagged are removed first.

**Retry from scratch** (`fresh`) discards `out/`, `work/`, `steps/`, `docs/` and the ledger and reads the same pinned commits.

## Lifecycle

| When | What goes |
|---|---|
| an attempt ends well, or the job is cancelled | the checkouts, `docs/`, `steps/`, `tmp/` |
| the job failed, after the checkout hours | the checkouts, `docs/`, `steps/`, `tmp/` (the next attempt makes them again) |
| the document write of `out/` is final (`committed`, `pr-opened`, `merged`, `closed`, `unchanged`) | the whole workspace |
| the job failed or was cancelled, or its write failed, after the retention days | the whole workspace |

`tmp/` is removed whenever an attempt ends. The mirrors forget the worktrees of folders that are gone in the hourly sweep.

## Settings

The hours and days above, the limits of the processes in a workspace (script and agent timeouts, the idle limit, the output size, turns and cost) and the read-only marking are set in **Settings → Sandbox** ([configuration](configuration.md#the-sandbox-environment)). **Monitoring → Sandbox** lists the workspaces on disk with their run, state, size and removal time, and an admin (`sandbox.manage`) can remove one that is no longer needed: the worker deletes it, never one whose run is active or whose output write is pending ([ADR-0058](../decisions/0058-sandbox-workspaces-in-monitoring.md)).
