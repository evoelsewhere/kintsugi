---
name: understand-planning
description: "Plan the order in which catalog items should be understood. Read the item dependency graph and the assessment, group items into reviewable batches and justify each batch. Use when asked to plan, sequence or batch items for the understand stage."
metadata:
  argument-hint: "[application id]"
---

# Planning what to understand first

An AS-IS specification of an item cites what the item calls and what calls it. The order in which items are
understood therefore decides how good the later specifications are, and how much a reviewer must hold in mind.

## Inputs

- `graph.json`: one entry per catalog item. Fields and how to read them: [references/item-graph.md](references/item-graph.md).
- `ASSESSMENT.md`: the assessment (summary, recommended pattern, risks, security findings).
- `catalog.json` and `topology.json` for names and detail, when the graph is not enough.

Only **open** items are planned: `understood` is false and `assetClass` is `code`. Test and generated items are never
planned.

## Rules that decide an order

1. **Cycles stay together.** Items of one `cycle` describe each other: one batch, even if it is the largest.
2. **Foundations first.** High `fanIn` or low `depth` means many specifications cite the item. Understand it before its
   callers, so they cite it instead of guessing. A large foundation is not a reason to defer it.
3. **A callee with its main callers** when the batch can hold both; `usedBy` and `dependsOn` show who they are. If the
   callers must wait, the batch's `dependsOutside` will list the gap: prefer to avoid it.
4. **Risk early.** Items the assessment ties to critical or high findings, to sensitive data stores or to the entry
   points it calls out go early, together with the items that reach them.
5. **Shared data stores are a bond.** Items writing the same store (see `dataStores`) read well together.
6. **Respect module boundaries** unless a rule above says otherwise; a module split over batches needs a reason.
7. **Size for review.** At most 8 items and a few thousand code lines per batch (the job states the exact caps); a
   reviewer must be able to read the pull request.
8. **Leave out what is not worth it yet**: tiny, trivial, thin wrappers nobody depends on (`fanIn` 0, small `loc`, low
   complexity). Say so in `leftOut` with a reason.

## Writing the plan

Return the structured result the task asks for.

- **strategy**: two to four sentences: the order and why.
- **batches** in the order they should run, each with a short `title`, the `items`, a `rationale` and a `risk`
  (`high`: the batch holds foundations or what the assessment calls critical; `low`: neither).
- **rationale**: two to three sentences that a reviewer can check against the graph. Cite numbers
  ("fan-in 12", "cycle of 3 items", "writes ds:ORDERS with 2 others") and assessment facts (a finding id or heading).
  "Important" and "core" are not reasons.

## Pitfalls

- A graph with no edges (`stats.topology` false or `edges` 0) says nothing about relationships: plan by module,
  size and the assessment, and say in the strategy that relationships were not available.
- Do not invent ids or numbers. The check drops unknown items and recomputes size and cohesion.
- Do not plan the same item twice.
