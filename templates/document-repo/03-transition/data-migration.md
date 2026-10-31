---
title: "Data migration plan"
status: "draft"
version: 1
---
# Data migration plan

How the data gets from the legacy stores into the target: what moves, in which order, how it is converted, how it is proven complete and how it is undone. The ownership of the data while both systems run is in [coexistence.md](coexistence.md); the target stores are in `../02-architecture/data-architecture.md`.

## Scope

| Source | Target | Entities | Volume | Moves in wave |
| --- | --- | --- | --- | --- |
| <!-- legacy database or file --> | <!-- target store --> | <!-- Invoice, Customer --> | <!-- rows or GB --> | <!-- 1 --> |

## Approach

| Topic | Decision |
| --- | --- |
| Method | <!-- one final load, an initial load plus change capture, a copy per unit --> |
| Tooling | <!-- the extract, transform and load tools --> |
| Downtime | <!-- window per wave, or none --> |
| Rehearsals | <!-- how many, on which data, who signs them off --> |

## Order

Entities move in dependency order; a child never moves before its parent.

```mermaid
flowchart LR
  ref["Reference data"] --> customer["Customer"]
  customer --> invoice["Invoice"]
  invoice --> line["Invoice line"]
```

<!-- Replace with the real order. -->

## Mapping rules

The mapping of every field is in the data objects of the units (`data-objects.md` in each unit's `01-legacy/` folder) and in `../01-standards/mappings/`; list here the rules that cut across them.

| Rule | Legacy | Target | Applies to |
| --- | --- | --- | --- |
| DM-01 | <!-- a date held as the number 00000000 --> | <!-- null --> | <!-- all date columns --> |
| DM-02 | <!-- trailing spaces in codes --> | <!-- trimmed --> | <!-- all code columns --> |

## Cleansing

| Defect | How found | Handling | Owner |
| --- | --- | --- | --- |
| <!-- duplicate customers --> | <!-- query --> | <!-- merge by rule, or reject and report --> | <!-- business owner --> |

## Reconciliation

Every load is proven before the cut-over: nothing lost, nothing changed.

| Check | Method | Tolerance | Evidence kept in |
| --- | --- | --- | --- |
| Row counts per entity | <!-- count query on both sides --> | 0 | <!-- the rehearsal report --> |
| Totals of amounts | <!-- sum per period --> | 0 | <!-- --> |
| Sample comparison | <!-- field by field, N records, chosen by risk --> | 0 differences | <!-- --> |
| Business rules | <!-- the parity tests of the units --> | all pass | <!-- the test report --> |

## Rollback

| Situation | Action | Data left behind |
| --- | --- | --- |
| <!-- load fails halfway --> | <!-- discard the target data of this load and rerun --> | <!-- none --> |
| <!-- defect found after cut-over --> | <!-- see coexistence.md: rollback --> | <!-- how writes since cut-over are carried back --> |

## Schedule and responsibilities

| Activity | Responsible | When |
| --- | --- | --- |
| <!-- rehearsal 1 --> | <!-- name --> | <!-- date --> |
