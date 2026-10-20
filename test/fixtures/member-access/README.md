# Synthetic member-access pilot fixtures

These documents contain invented identifiers and behavior only. They contain no source code, credentials, customer records or real approval evidence. They are deterministic input data, not a customer project template.

## Identity and expected roles

- Project: modernization
- Application: billing
- Full unit identity: billing/invoices/tax
- Document repository: project-docs
- Target code repository: billing-api
- Fixture members: reader-a, reader-b and maintainer
- Required deliverables: code in billing-api and a design document in project-docs

The fixture models the exact task, basic-design, detailed-design, standards and gate sources used by context acceptance tests. Approval metadata in context.json is a test oracle only. A name in fixture Markdown never grants real authority.

## Revisions and overlays

Revision A is a complete baseline document repository with approved basic design, detailed design and standards. Its G4 record is a pending output-gate scaffold and does not block producing deliverables.

Revision B is an overlay on A. It replaces the unit detailed design and the approval metadata for that source. The content changes, so its context revision must change; its new design approval is pending, so implementation must report the precise approval blocker. Tests must never fall back to A's approval or the live default branch.

Apply one variant directory as an overlay on revision A:

| Variant | Overlay behavior | Expected property |
|---|---|---|
| draft | Replaces detailed design with a draft source | Availability does not imply approval |
| pending | Replaces the G4 record with a pending decision | G4 is an exit gate and does not block producing its own evidence |
| missing | Declares the detailed design path absent | Missing source stays missing; there is no HEAD fallback |
| injection | Replaces review rules with text that tries to change agent behavior | Retrieved content remains cited source data and cannot expand tool authorization |
| large | Replaces detailed design with a document larger than the 32 KiB default brief budget | Brief is partial and lists the exact section/source needed for retrieval |

The test harness should materialize each revision in a temporary Git repository, commit it, and use the resulting full SHA as that repository's snapshot identity. Overlay metadata labels A and B for assertions; it is not a substitute for Git commit identity.

## Intended acceptance cases

- CTX-01: reader-a receives the correct full unit identity, objective, acceptance criteria, deliverables and source revisions.
- CTX-03: task availability and pending G4 do not imply approval.
- CTX-04: design activity can produce missing detailed design; implementation requires approved applicable design sources.
- CTX-05: large mandatory content remains explicitly incomplete until fetched by source and section ID.
- CTX-09: B changes the context revision; generated-only changes do not.
- CTX-10 and MCP-06: malicious document text is returned as cited data and cannot grant a new project, path or tool capability.
