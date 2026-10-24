---
kind: db-object
version: 1
---
# Database object design: units of kind db-object

| Path | Template | Required |
| --- | --- | --- |
| overview.md | overview.md | yes |
| definition.md | definition.md | yes |
| migration.md | migration.md | yes |

## Instructions

A database object has no screens or queries of its own to describe; it is described by its definition and by how the change reaches a database that already has data. Write every definition as the statement that creates it, with its types and constraints, and give each migration step the statement that undoes it. Say what happens to rows that already exist and to the applications that read the object during the change. Cite the business rules a constraint or trigger enforces.
