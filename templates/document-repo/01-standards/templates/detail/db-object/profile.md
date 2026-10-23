---
kind: db-object
version: 1
removes: ["data-access.md"]
---
# Detail design: database objects

A database object has no queries of its own to describe; it is described by its definition and by how the change reaches a database that already has data.

| Path | Template | Required |
| --- | --- | --- |
| ddl.md | ddl.md | yes |

## Instructions

Write every definition as the statement that creates it, with its types and constraints, and give each migration step the statement that undoes it. Say what happens to rows that already exist.
