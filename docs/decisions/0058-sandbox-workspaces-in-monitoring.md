# ADR-0058: The job workspaces are listed in Monitoring and an admin can remove one

- Status: Accepted
- Date: 2026-10-22
- Decision register: D74

## Context

A job workspace outlives its attempts ([ADR-0055](0055-one-durable-workspace-per-job.md)) and is removed by the worker's
sweep: at once when the write of its output has landed, after the retention period for the output of a failed run, and
for a folder no run refers to. Settings → Sandbox sets the periods, but nothing shows what is on the disk now. An
administrator could not tell which workspaces exist, which run each belongs to, what state it is in, how much a failed
job is holding, or when it goes, and had no way to free a disk before the sweep.

## Decision

**1. Monitoring lists the workspaces in its Runtime tab**, under the workers and their queues: both answer whether the
environment jobs run in is healthy, and the worker owns the workspaces (the queue `workspace-cleanup` is in the same
page). It is live state of the installation, not a setting. It lists every workspace on the data volume with its job id, its run (stage, project,
application, attempt, status), the lifecycle in its manifest (`running`, `parked`, `published`), whether its checkouts
are still on disk, the size of what a retry cannot make again, and when the sweep removes it. Settings → Sandbox keeps
the settings only.

**2. The list is read by the API, the removal is done by the worker.** The API mounts the data volume read-only
([ADR-0006](0006-self-hosted-package.md) and the compose file keep the worker the only writer), so
`GET /api/monitoring/sandbox/workspaces` reads the folders and the manifests and joins the runs in Postgres, and
`DELETE /api/monitoring/sandbox/workspaces/:jobId` (permission `sandbox.manage`, audited as
`sandbox.workspace-remove`) hands the removal to the worker through a new queue, `workspace-cleanup`
(`{ jobId, actor }`, not retried). The worker removes the folder with the code the sweep uses.

**3. A workspace that is needed is never removed.** The API refuses (409) and the worker checks again, in the process
that owns the disk, when the job arrives: a run that is `queued` or `running`, or whose output has a document write that
has not run yet, is left alone. Anything else may go, including the workspace of a failed job (a retry then begins from
nothing: the confirmation says so) and a folder no run refers to.

**4. The size is bounded.** The size shown is that of everything but the checkouts (`as-is/`, `to-be/`, `docs/`), which a
retry makes again from the pins; the walk stops after 20 000 entries per workspace and the portal then shows a lower
bound (`≥`). Listing must stay quick on a volume with thousands of files.

## Consequences

- An admin sees and frees disk without a shell on the server. The same data is what the debug MCP's workspace tools read
  ([ADR-0056](0056-debug-mcp-for-development-installations.md)), so the two views agree.
- A removal takes a few seconds (a queue hop): the portal says "queued" and looks again.
- The rule "what may be removed" exists twice, in the API (to refuse early and to show `blockedBy`) and in the worker (to
  decide); they are kept equal by tests on both sides.

## Not done

- Removing several workspaces at once, or "remove everything the sweep would remove now".
- A size for the checkouts, and a per-folder breakdown.
