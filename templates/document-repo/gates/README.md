# `gates/`

- Written by: people (the approvers named in each record), through review pull requests
- Serves: the project-level gates G0 (bootstrap) and G3 (pilot exit / factory readiness)
- Auto-commit: never — gate records always arrive as pull requests

One file per project-level gate record. Application gate records live in
`applications/<app>/gates/`; a unit's G4 record lives under the unit's `reviews/`.

## Record format

```text
- Decision:            approved / rejected / pending
- Approvers:           names and roles
- Evidence:            paths in this repository supporting the decision
- Date:                YYYY-MM-DD
```

The files here are placeholders with that format. They do not supply effective gate evidence.

For evidence-bound unit approvals, use the authenticated decision flow. It publishes a reviewed Markdown record containing the decision/audit identity, context and policy revisions, required deliverable IDs and immutable provider merge revisions. The worker verifies the merged record and authorized human approvals before the gate becomes effective. A typed approver name or an edited placeholder is insufficient.
