# ADR-0090: Retry cancelled runs, and pin project memory to a revision

- Status: Accepted
- Date: 2026-10-31
- Decision register: D104
- Amends: [ADR-0055](0055-one-durable-workspace-per-job.md) (what a cancelled job keeps, what a step's fingerprint holds)

## Context

[ADR-0055](0055-one-durable-workspace-per-job.md) made a retry of a failed stage run the next attempt of the same job, in the same workspace, skipping the steps whose fingerprint is unchanged and whose results are still there. Three gaps showed in practice:

- **A cancelled run lost what it had done.** Retry was offered only for a failed run, and cancelling dropped the checkouts, `steps/` and `work/` at once. The most common reason to cancel is a step that loops; the steps that had finished before it (often half an hour of agent work) were thrown away with it.
- **With project memory on, a retry reused no agent step.** A step that can read project memory added the attempt number to its fingerprint ([ADR-0078](0078-agent-memory-learning-lifecycle.md) treats memory as a live input), so every retry ran every such step again, while the portal said the retry "reuses the steps whose inputs have not changed".
- **A failed agent step left no trace of why.** The run's events name each tool call, never what it returned; a model that searched 400 times for a file it had written could only be guessed at.

## Decision

1. **A cancelled stage run is retried like a failed one.** `POST …/job-runs/:runId/retry` (and *Retry from scratch*) accepts a run that is `failed` or `cancelled`. When a run is cancelled the worker records the steps it finished in the run's summary, merges what the finished members of a group wrote, and keeps the workspace as for a failure: the checkouts and `steps/` until the checkout hours, `out/`, `work/` and the ledger until the retention days. The next attempt skips the steps that finished.
2. **Project memory is pinned to a revision.** A step that can read project memory adds to its fingerprint a digest of the memory it can see (the entries in its scope, their review state, the epoch), leaving out what its own run wrote or forgot: those changes belong to steps that are reused or run again with them. The step is reused while nobody else writes, forgets, restores or reviews an entry, and runs again when someone does.
3. **Web lookups stay live, and the retry says so.** A step whose agent may search or fetch the web has no revision to pin: it still runs again on every retry. The retry answer lists those agents (`rerunsWebAgents`), the portal's notice names them, and the run's log says for each such step why it runs again.
4. **A failed agent attempt keeps a diagnostic tail.** The kernel previews the start of each tool result in its `tool.result` event (300 characters). When an agent attempt fails or is stopped, the worker records its last 20 tool calls in the run's events, each with whether it worked and the redacted preview of what it returned. The content of a file the model read is never kept: a `read` that worked is recorded as such.
5. **Plain failures, one more try for a dropped connection.** Known raw failures (a header character Node cannot send, a repository without commits) are recorded in plain words with the raw text as the detail, for runs, steps and repository syncs. An agent step that fails with a connection error gets the one more try a rate limit or a server error already had; a known failure of the settings does not.

## Consequences

- Cancelling a looping step costs that step only; *Retry run* continues from the others.
- A cancelled job's workspace takes disk space for the same time as a failed one's; the sweep and *Monitoring → Runtime* treat both alike.
- A retry with project memory on reuses its agent steps unless another run or a person changed the memory; a step can still see entries its own run wrote in an earlier attempt, which a step that ran in that attempt saw too.
- A step with web lookups costs a full run on every retry; the portal now says so instead of promising reuse.
- The run's events hold, for failed and stopped agent attempts only, up to 20 short redacted previews of tool results. A preview of a listing or a search can name files and quote a line of the source; it is redacted like every event, never the content of a file read.

## Alternatives considered

- **Pin memory to its last change time when attempt 1 started.** Simpler, but a later change by another run would be hidden from the reuse decision, and a change by the run itself would still defeat reuse.
- **Keep previews only in the worker's log.** The log is not what a person reads on the run page; the events are, and the portal's console and *Copy diagnostics* already show them.
