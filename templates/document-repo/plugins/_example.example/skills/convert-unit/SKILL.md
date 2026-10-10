---
name: convert-unit
description: Convert one unit of this project's source stack into the target base, following the project's standards. Use when working on a Kintsugi task in the migrate phase.
---

# Convert a unit (TODO: adapt to the stack pair)

1. Read the task pack and every rule it cites. They come from `standards/` in the document repo.
2. Locate the legacy entry points listed in `relevantPaths` and read them fully.
3. Apply the mappings construct by construct. When a construct has no mapping, stop and ask: the fix is a new mapping in `standards/mappings/`.
4. Build only from the target base's components and conventions (`standards/conventions/target.md`, `standards/conventions/ui.md`).
5. Write or update unit tests as the conventions require. Run the target build and tests locally.
6. Follow the `kintsugi-task` skill for commits, trailers, PRs and deliverable registration.
