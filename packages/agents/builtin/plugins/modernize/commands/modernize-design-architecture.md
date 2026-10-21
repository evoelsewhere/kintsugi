---
description: Write the common design of the target (the architecture and the common components) and the application's own design, with two human checkpoints
argument-hint: <app> [target-vision]
arguments: app
metadata:
  audience: member
  agents: [legacy-analyst, architecture-critic]
  skills: [mermaid-diagrams]
  reads: [standards/, architecture/, applications/<app>/inputs/INTENT.md, applications/<app>/assessment/ASSESSMENT.md, applications/<app>/assessment/topology.md, applications/<app>/assessment/*.mmd, applications/<app>/generated/BUSINESS_RULES.md, applications/<app>/generated/DATA_OBJECTS.md, applications/<app>/units/<module>/<unit>/understanding/rules-review.md]
  writes: [applications/<app>/to-be/requirements.md, architecture/blueprint.md, architecture/common/<component>.md, applications/<app>/to-be/design.md]
  gates: ["P0 capabilities and deliberate drops (checkpoint 1)", "architecture approval before the skeleton is scaffolded (checkpoint 2)"]
---

The first token of `$ARGUMENTS` is the application id (`$app`, from `kintsugi.yaml`); **everything after it is the target
vision**, usually several words, so do not truncate it (with none, use the one in `applications/$app/inputs/INTENT.md`).
Below, `<vision>` means that whole remainder.

This is the **common design**: what every unit of the rebuild shares, written once by the foundation team (or whoever the
pipeline names as performer) before any unit is designed. It produces the target architecture, the **common components**
each unit reuses by id (authentication, logging, error handling, transactions, the batch framework, data access, naming and
layering rules), and the part of the design that is specific to `$app`. It writes no code: the skeleton of the target
repositories is the `scaffold` command, after the architecture is approved.

This command runs in your own harness through Kintsugi's member plugin. Inputs come from the **document repository**
(`applications/$app/assessment/...`, the units' `understanding/` folders, `standards/`); the **legacy repository** of `$app` is
your local clone, **read-only** (Kintsugi's member hooks refuse writes to it). Before you start, say in one line which source
commit you read: the one the assessment recorded for `$app` (`sourceCommit` in `applications/$app/assessment/inventory.md`, and in
the portal); check out exactly that commit. Everything this command writes goes on your own branch of the document repository
and reaches the project through a pull request. Run every subagent in the foreground and wait for its result: never end your
turn while one is still running. Stop any server or other process you started before you finish, and say you did.

The design is **not a port**: the legacy system is the *specification source*, not the structural template. The command has
two explicit human checkpoints, both **portal gates**: at each, stop and tell the user which gate to request; re-running
`/kintsugi:modernize-design-architecture $app <vision>` continues from the next phase once the portal shows the gate approved
(the result is recorded under `gates` in the unit files in `applications/$app/units/` of the document repository: pull it). On a
re-run, reuse what is already written and do not repeat a phase whose gate is approved.

## Phase A — Capabilities and requirements

Reuse what the understanding stages produced, honoring each unit's `rules-review.md` (a rule marked `refuted` is not part of the
specification as written; a P0 rule marked `clarify` is a question for checkpoint 1): `BUSINESS_RULES.md` and `DATA_OBJECTS.md` in
`applications/$app/generated/`, `topology.md` and `ASSESSMENT.md` in `applications/$app/assessment/`, and the units' `as-is.md`. If
the interface catalog or the domain entities are missing, spawn **legacy-analyst**: "Catalog every external interface of the
legacy repository of $app: inbound (screens, APIs, batch triggers, queues) and outbound (reports, files, downstream calls, DB
writes), with name, direction, payload shape and frequency or SLA if discernible; mask credentials. Then list the core domain
entities and their relationships as a Mermaid erDiagram (keys marked PK/FK, every relationship labelled)."

Write `applications/$app/to-be/requirements.md`: one section per requirement, `## REQ-<AREA>-<NNN>: <title>`, the requirement in
one or two sentences, and a `**derivedFrom:**` line naming the rule ids it derives from (Kintsugi's traceability reads these).
Group them by capability and mark the P0 ones. Name the source commit the requirements were mined from.

## Phase B — Checkpoint 1

Push the requirements to the document repo pull request, summarize them, and **stop**: tell the user to request the **P0
capabilities** gate in the portal with **one focused question**: "Which of these capabilities are P0 for the rebuilt system, and
should any be deliberately dropped?" On the re-run after the gate, record the answer from the gate in `requirements.md`.

## Phase C — The common design, then the critique

Read `standards/` first (the project's conventions and mappings are constraints, not suggestions) and `architecture/`, where the
project may already have started. Write, under the project's `architecture/`:

- `blueprint.md`: the target architecture for <vision> as a Mermaid `C4Container` diagram (per the `mermaid-diagrams` skill; lint it
  with the skill's `mermaid_lint.py`), the components and their boundaries with the reason for each (which rules and entities live
  where), technology choices with a one-line justification each, the cross-cutting rules (layering, naming, error handling,
  transactions, logging), and how the legacy data is migrated.
- `common/<COM-id>.md`, one document per common component the units will reuse, the id of the form `COM-<AREA>-<NN>` (for example
  `COM-LOG-01`). Each has front matter `id`, `title` and `status: draft`, and the sections **Purpose**, **Interface** (how a unit
  calls it) and **Rules of use** (when a unit must and must not). Unit designs refer to a component by this id, so the id never
  changes once approved.

Then write `applications/$app/to-be/design.md`, what is specific to this application: its components and which target
repository implements each, the interfaces between them, who owns which data, and a table mapping each AS-IS module to the
component that takes it over.

Get the critique: if an architecture-critic review of this design is in `reviews/` of the document repository, reuse it;
otherwise spawn **architecture-critic**: "Review `architecture/blueprint.md`, the common components and
`applications/$app/to-be/design.md` for <vision> against the requirements: over-engineering, missed requirements, scaling risks,
simpler alternatives." Incorporate the critique.

## Phase D — Checkpoint 2

Push the design to the document repo pull request and **stop: scaffold nothing until the architecture is approved** (plan mode if
available). Tell the user to request the **architecture approval** gate in the portal. The approval authorizes the skeleton, and
edits a reviewer makes at the gate are binding. When it is approved: `/kintsugi:modernize-scaffold $app`, and, in parallel, the
**basic design** of the units with `/kintsugi:modernize-design $app <module/unit> <set>` (the sets are the project's, in
`standards/design/`).

Report: the capabilities and requirements written, the common components (id and title), the components of `$app`, the critique's
HIGH items and how each was handled, and where the documents are (the portal shows them once the pull request is merged).
