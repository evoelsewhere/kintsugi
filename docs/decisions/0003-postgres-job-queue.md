# ADR-0003: pg-boss (Postgres-backed job queue) for orchestration

- Status: Accepted (supersedes an earlier Temporal proposal)
- Date: 2026-10-09

## Context
Kintsugi ships as a self-deployed Docker Compose package (ADR-0006) whose only datastore is Postgres (ADR-0010). Pipelines are long-running and wait on human approvals, but each step is short: a runtime job, a git sync, or a commit.

## Decision
- Use a Postgres-backed job queue (**pg-boss**) for asynchronous work: runtime jobs, git sync and polling, ingestion, and commit/PR creation.
- Pipeline, stage and gate progress is an explicit state machine stored in Postgres tables. Human approvals are state transitions made through the API; they are not long-lived workflow executions.

## Consequences
- Pros: no extra infrastructure to install or operate; transactional with application data.
- Cons: retries, timeouts and idempotency must be implemented explicitly. Revisit Temporal if pipelines need complex compensation logic or very high throughput.
