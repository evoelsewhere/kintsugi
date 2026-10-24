---
title: "Program charter"
status: "draft"
version: 1
---
# Program charter

Why the program exists, what it covers and how it is judged. Agreed at gate G0 and changed only through a pull request that the sponsor approves.

## Objective

<!-- One paragraph: what this migration program achieves and why now (end of support, cost, risk, a business need). -->

## Background

<!-- The current situation in a few lines: the legacy systems, their age and problems, what has been tried. -->

## Scope

| In scope | Out of scope |
| --- | --- |
| <!-- applications, modules and interfaces the program migrates --> | <!-- what stays, is retired or is handled by another program --> |

Applications in scope are declared in `kintsugi.yaml`.

## Success criteria

Measurable outcomes the program is judged on; the baseline each starts from is in [kpi-baseline.md](kpi-baseline.md).

| Id | Criterion | Measure | Target | Due |
| --- | --- | --- | --- | --- |
| SC-01 | <!-- e.g. functional parity --> | <!-- business rules verified against the legacy system --> | <!-- 100% of rules confirmed --> | <!-- date or wave --> |

## Stakeholders

| Name or group | Role in the program | Interest | Influence |
| --- | --- | --- | --- |
| <!-- sponsor --> | sponsor | <!-- --> | high |

Who is responsible for what is in [raci.md](raci.md).

## Milestones

| Milestone | Gate | Date | Depends on |
| --- | --- | --- | --- |
| Framing agreed | G0 | <!-- --> | - |
| Portfolio decided | G1 | <!-- --> | <!-- --> |
| Target architecture approved | G2 | <!-- --> | <!-- --> |

The waves and their units are in [portfolio/wave-plan.md](portfolio/wave-plan.md).

## Assumptions and constraints

| Kind | Statement | Effect if it does not hold |
| --- | --- | --- |
| assumption | <!-- e.g. the legacy owners are available for rule verdicts --> | <!-- --> |
| constraint | <!-- budget, date, technology, regulation --> | <!-- --> |

## Risks

The program risks are in [risks.md](risks.md); the architecture risks are in `../02-architecture/blueprint.md`.
