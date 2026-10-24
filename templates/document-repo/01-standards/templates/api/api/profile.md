---
kind: api
version: 2
---
# API design: units of kind api

| Path | Template | Required |
| --- | --- | --- |
| overview.md | overview.md | yes |
| endpoints.md | endpoints.md | yes |
| security.md | security.md | no |

## Instructions

Describe the interface as a caller sees it, not how the legacy code serves it: read the unit's AS-IS specification for behaviour, never copy its transaction names or screen flow into paths. Give every operation an id (API-001, ...) that never changes once written, and cite every business rule of the unit from the operation that applies it. Name every field, type, status and error code; a builder must not have to guess. Write `security.md` when the unit has any authentication, authorisation or sensitive data, which is almost always.
