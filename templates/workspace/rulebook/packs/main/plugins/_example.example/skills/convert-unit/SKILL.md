---
name: convert-unit
description: Convert one unit of this project's source stack into the target base, following the pack's mappings, UI patterns and conventions. Use when working on a Kintsugi task in the migrate phase for this pack.
---

# Convert a unit (TODO: adapt to the stack pair)

1. Read the task pack and every rule it cites. The cited rules come from `mappings/`, `ui-patterns/` and `review-rules/` in this pack.
2. Locate the legacy entry points listed in `relevantPaths` and read them fully.
3. Apply the mappings construct by construct. When a construct has no mapping, stop and ask: the fix is a new mapping in the rulebook.
4. Build only from the target base's components and conventions (`conventions/target.md`, `conventions/ui.md`).
5. Write or update unit tests as the conventions require. Run the target build and tests locally.
6. Follow the `kintsugi-task` skill for commits, trailers, PRs and deliverable registration.
