# Evidence-bound gate records

The authenticated gate decision API publishes unit records to `10-applications/<app>/02-modern/<module>/<unit>/reviews/<gate>.md`. It always asks the document writer for `reviewAll: true`. Scaffolded gate names, a database approval, branch ancestry and an actor typed into Markdown do not establish an effective approval.

A version 1 record contains a readable summary and exactly one evidence block between `<!-- kintsugi-gate-evidence:v1 -->` and `<!-- /kintsugi-gate-evidence -->`. Its JSON object carries:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `decisionId`, `auditEventId` | Immutable decision and authenticated audit identities |
| `projectId`, `unitId`, `gateId` | Project, full application/module/unit identity and gate |
| `decision` | `approved`, `rejected` or `waived`; rejection requires `decisionReason` |
| `contextRevision`, `policyRevision` | Reviewed context fingerprint and policy identity |
| `actor` | User ID and session authorization identity, verified through the retained audit proof |
| `requiredDeliverableIds` | Complete required set, including explicitly waived deliverables |
| `deliverables` | Non-waived artifact IDs, repository IDs, stable provider PR IDs, review-result IDs, reviewed revisions and final provider merge revisions |
| `deliverables[].path` | Optional safe repository path; new decisions always bind it. Source approvals require it so a design approval survives the task moving to code outputs |
| `waiver` | Explicit deliverable scope and immutable rationale; at least one deliverable must remain verified |

The whole record is limited to 65,536 UTF-8 bytes. The visible summary must match its evidence block. Changes to an accepted evidence basis need a new decision and reviewed record, preserving the old decision and audit history.

The worker observes the gate PR through its registered provider repository identity, requires an independent mapped human approval for its exact head before merge, and reads the record at the provider's final merge SHA. Deliverable PRs are re-observed and must retain the recorded head, final merge revision, complete passing review, current context and pre-merge human approval. Dismissed, missing or post-merge approvals remain blockers. The gate record cannot be one of its own deliverables. Its validation does not wait for its own effective gate.

After verification, `workflow.gate_publication` and the `gate.effective` durable event are committed through one idempotent transaction, keyed by decision and evidence hash. Continuation consumes that event in the next workflow step; publication does not invent subsequent tasks. Failed writer attempts retain the decision and durable write identity for retry. Missing provider or Git objects remain pending. Changed context or evidence is stale. A closed gate PR or invalid evidence requires repair and a new reviewed basis where appropriate.

See [ADR-0054](../decisions/0054-evidence-bound-pr-continuation.md) and the [document write path](document-repo-write-path.md).
