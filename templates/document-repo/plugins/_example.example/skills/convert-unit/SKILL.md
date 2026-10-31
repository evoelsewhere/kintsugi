---
name: convert-unit
description: Convert one designed unit of this project's source stack into the target base, following the project's standards. Use when building a unit whose design is merged.
---

# Convert a unit (TODO: adapt to the stack pair)

1. Read the unit's merged design (`10-applications/<app>/02-modern/<module>/<unit>/<set>/`) and its rules (`10-applications/<app>/01-legacy/<module>/<unit>/rules.md`) with `document_get`, and the standards they cite from `01-standards/`.
2. Read the legacy files the unit's specification cites, in full.
3. Apply the mappings construct by construct. When a construct has no mapping, stop and ask: the fix is a new mapping in `01-standards/mappings/`.
4. Build only from the target base's components and conventions (`01-standards/conventions/target.md`, `01-standards/conventions/ui.md`).
5. Write or update unit tests as the conventions require. Run the target build and tests locally.
6. Commit and open the merge request as the project's conventions say.
