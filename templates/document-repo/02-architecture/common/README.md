# `02-architecture/common/`

- Written by: people (the foundation team), through review pull requests
- Serves: P2-P4; what every unit's design reuses
- Auto-commit: no — changes arrive as pull requests

One document per **common component**: something every unit reuses instead of designing again (authentication, logging, error handling, transactions, the batch framework, data access). The file name is the component's id, `COM-<AREA>-<NN>` (for example `COM-LOG-01.md`). A unit's design refers to a component by this id, so an id never changes once it is approved.

```markdown
---
id: "COM-LOG-01"
title: "Audit log"
status: "draft"
---
# COM-LOG-01: Audit log

## Purpose
Why the component exists and what it guarantees.

## Interface
How a unit calls it: the operation, its inputs and its result.

## Rules of use
When a unit must call it, and what it must never do.
```

`status` is `draft` until the architecture approval gate; the foundation team writes these in `/kintsugi:modernize-design-architecture`. The design checks resolve `COM-` ids against the files of this folder.
