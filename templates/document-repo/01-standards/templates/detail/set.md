---
id: detail
title: Detail design
version: 1
needs: ["basic"]
stage: detail-design
---
# Detail design

How the unit is built: the logic of each function, its errors, the common components it uses and the cases that test it. Written just before the unit is coded, by the developer with their harness; precise enough that the code can be generated from it. A unit kind with a folder here (`screen/`, `batch-job/`, `db-object/`, `report/`) is written with that folder's profile: its own template, and its own documents. TODO: replace this set with the project's own format.

| Path | Template | Required |
| --- | --- | --- |
| logic.md | logic.md | yes |
| data-access.md | data-access.md | no |

## Instructions

Cite every business rule by its id from the unit's rules and every function by its F-nnn from the basic design. Name every type, condition, message and error code: the code is generated from this document.
