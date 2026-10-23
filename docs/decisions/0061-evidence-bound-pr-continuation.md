# ADR-0061: Continue workflows from evidence-bound pull requests and gates

- Status: Accepted
- Date: 2026-10-20
- Decision register: D77
- Amends: [ADR-0007](0007-git-as-source-of-truth.md), [ADR-0028](0028-remove-rulebook-single-document-repo.md), [ADR-0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md), [ADR-0051](0051-document-repo-layout-legacy-and-modern.md)

## Context

Members implement work in their chosen harness and open ordinary Git pull requests. Kintsugi must discover pull requests opened while the developer is offline, fetch current provider state, review a complete and fixed revision, expose actionable findings, and continue only after required human and Git evidence is effective. A webhook alone can be missed; a database decision alone is not the merged gate record defined by the document-repository model.

## Decision

1. GitHub.com is the first provider family. GitHub Enterprise Server is supported only for an exact version and configuration recorded after a successful compatibility probe. GitLab, Bitbucket, Azure DevOps and AWS-hosted Git services are later provider adapters. AWS hosting does not identify the Git protocol or API.
2. PR discovery combines signed provider notifications when reachable with durable reconciliation of current open, closed and merged PR state. Polling remains available for private installations without inbound webhooks. Provider cursors advance only after every page in a sweep is persisted; an overlap and deeper backfill discover missed or reordered changes.
3. A PR is associated with a project, repository, full unit identity and required deliverable through validated repository configuration and explicit evidence. The worker fetches the provider's current PR, head, base, merge result, reviews and checks rather than trusting event payload text. Duplicate delivery and provider retries do not schedule duplicate effective reviews.
4. Each review generation fixes the PR head and base revisions, relevant context snapshot, policy version and reviewer version. Required files and objects must be completely available. Findings identify their reviewed revision and citations. A new relevant head or context revision makes older findings stale; partial or inconclusive input cannot pass.
5. Kintsugi does not merge or approve a member's code PR. Provider-required checks and human review apply before the deliverable merge. The effective unit/phase gate applies after the required code and document deliverables have merged and records their exact final revisions.
6. A human gate decision is bound to an immutable evidence manifest and authenticated actor. The document writer publishes a readable gate-record PR; only a validated merged record that covers every required deliverable and satisfies reviewer policy becomes effective. Pending publication, changed evidence, incomplete review and unauthorized actors remain blockers. A gate record cannot approve itself.
7. After current Git evidence is validated, one database transaction updates the operational projection, durable workflow event/outbox and next-step intent. External Git publication has a durable operation identity so retries can reconcile a successful write. Replaying the same decision/evidence advances the workflow once.
8. The portal and CLI can stream durable workflow events over authorized SSE and resume from event IDs. Provider discovery and review continue while clients are disconnected; an SSE connection is a view of workflow progress, not its trigger.
9. The pilot ordering is automated review, required provider checks and human approvals, merge of every required deliverable, evidence-bound G4 decision and merged gate record, then exactly-once next-step continuation.

The implemented version 1 [gate-record schema](../reference/gate-records.md) binds artifact paths as well as provider PR and revision identities. Source approvals use this immutable path binding after a task changes its required output list. Publication effectiveness is projected atomically with a durable `gate.effective` event; the next-step planner consumes that handoff.

## Consequences

- Webhook delivery, polling, review attempts, current findings, gate evidence and workflow continuation have separate durable identities.
- Provider API gaps, rate limits, incomplete check results and inaccessible Git objects are visible as degraded or inconclusive states, never converted into approvals.
- The exact GitHub Enterprise Server version, provider permission set, check producer policy and reviewer authority policy remain release probes.
- SSE reconnects can recover durable events without keeping a developer's AI session alive.
- Git remains the source of truth; PostgreSQL is operational state, a rebuildable projection, the durable inbox/outbox and event history.

## Alternatives considered

- **Webhook-only discovery.** Rejected because a PR may open and merge during downtime or an endpoint may be unreachable.
- **Latest PR head or green check alone.** Rejected because it does not establish a complete review of the final merged evidence or its producer.
- **Database approval row alone.** Rejected because the effective gate must be auditable and bound to a reviewed, merged Git record.
- **Let Kintsugi merge or approve code PRs.** Rejected because the developer's provider policy and human reviewers remain authoritative.
