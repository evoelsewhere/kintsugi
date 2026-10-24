---
title: "RACI"
status: "draft"
version: 1
---
# RACI

Who is **R**esponsible (does the work), **A**ccountable (one person who answers for it), **C**onsulted (is asked before) and **I**nformed (is told after), for each activity of the program. Exactly one `A` per row.

## Roles

| Role | People or group | Project role in Kintsugi |
| --- | --- | --- |
| Sponsor | <!-- names --> | <!-- --> |
| Program lead | <!-- --> | <!-- --> |
| Architect | <!-- --> | <!-- --> |
| Analyst | <!-- --> | <!-- --> |
| Developer | <!-- --> | <!-- --> |
| Tester | <!-- --> | <!-- --> |
| Foundation team | <!-- --> | <!-- --> |
| Customer's subject-matter experts | <!-- --> | <!-- --> |

## Activities

| Activity | Sponsor | Program lead | Architect | Analyst | Developer | Tester | SME |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Approve the charter (G0) | A | R | C | I | I | I | C |
| Decide the portfolio and waves (G1) | A | R | C | C | I | I | C |
| Verify business rules | I | I | C | R | I | I | A |
| Approve the target architecture (G2) | I | A | R | C | C | C | I |
| Maintain standards and design templates | I | I | A | C | R | C | I |
| Review and approve a unit's design | I | I | A | R | C | C | C |
| Implement and test a unit | I | I | C | C | R | C | I |
| Accept a wave (G4) | A | R | C | C | C | R | C |

Replace the rows and the columns with the project's own; keep one `A` per row.

## Decision rights

| Decision | Decided by | Recorded in |
| --- | --- | --- |
| Scope change | <!-- --> | <!-- --> |
| An exception to a standard | <!-- --> | <!-- an ADR in 02-architecture/adr/ --> |
| Dropping a business rule | <!-- --> | <!-- an ADR --> |
