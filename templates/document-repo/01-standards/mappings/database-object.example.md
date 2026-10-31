---
title: "Database object"
status: "draft"
version: 1
---
# Database object

- **Recognize in legacy**: a table, a keyed file, a view or a stored routine of the legacy data store.
- **Target template**: <!-- the target schema's conventions: naming, keys, audit columns -->.
- **Behaviours to preserve**: key uniqueness, default values, the meaning of codes and null, what a delete does to related rows.
- **Allowed deviations**: only those covered by an ADR in `../../02-architecture/adr/`.

## Type mapping

| Legacy type | Target type | Notes |
| --- | --- | --- |
| <!-- fixed-length character --> | <!-- varchar --> | <!-- trailing spaces are trimmed --> |
| <!-- packed decimal --> | <!-- numeric with the same scale --> | <!-- rounding is unchanged --> |
| <!-- date as an 8-digit number --> | <!-- date --> | <!-- 00000000 means no date and becomes null --> |

## Structure mapping

| Legacy | Target | Notes |
| --- | --- | --- |
| <!-- repeating group --> | <!-- child table --> | <!-- the key of the child --> |
| <!-- record redefinition --> | <!-- one column per meaning --> | <!-- how the old overlay is read --> |
