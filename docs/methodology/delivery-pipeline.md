# Delivery pipeline

This page explains the migration delivery method Kintsugi supports. How the system implements it is described in the [architecture](../architecture/README.md).

## 1. The big picture

An as-is → to-be migration project combines three layers:

| Layer | Content | What Kintsugi does |
|---|---|---|
| **Factory** | Strategy & mobilization, solution enablement, operation & control, core infrastructure / automation, migration tools, verification, post-migration support, with **governance** across all of them | The module structure of the portal |
| **Lifecycle** | Discover → Requirement / Preparation → Migrate → Refine → Test → Go-live / Hypercare | Workflow engine: phase → stage → task, with quality gates |
| **Workforce** | Humans and AI working together: AI does the first pass, humans review and finish. New AI roles join the RACI (AI champion, AI engineer, prompt engineer, KM lead/engineer, AI practice owner) | RACI-based permissions and human-in-the-loop. The Kintsugi Runtime prepares and reviews; members implement with their own AI harnesses |

The key idea: **invest first in the knowledge base and the project's rules, then run migration at scale** ("design for auto-migration").

## 0. Building the project

Kintsugi is a common engine. Before a project can run the pipeline below, the team **builds** it.
- Everything stack- and project-specific lives in the project's single **document repo** ([ADR-0028](../decisions/0028-remove-rulebook-single-document-repo.md)): unit kinds and pipelines in `kintsugi.yaml`; target conventions, mappings and review rules as plain documents in `standards/`; member plugins in `plugins/`.
- Standards have no maturity: one applies once it is merged.

| Build step | Runs during | Done when |
|---|---|---|
| **Bootstrap**: create or join the document repo, register the AS-IS (`legacy`, `legacy-data`) and TO-BE (`target`) repos, choose or declare pipelines | P0 | Gate G0 |
| **Standards**: write `standards/` and `plugins/` | P1–P2 | The standards the pilots need are merged |
| **Pilot**: run 1–2 pilot units per unit kind and fix the standards | P3 | Gate G3 |
| **Evolve**: feed lessons learned back as PRs to `standards/` and `plugins/` | P4–P7 | Continuous |

Details: [document repository](../reference/document-repo.md) · how-to: [build a project](../guides/build-project.md).

## 2. Standard pipeline (P0 → P7)

The pipeline merges the common delivery approaches (reverse design & porting, re-write with existing design, rebuild) into one pipeline. It is configured per application by its **7R strategy**.

```
P0 Mobilize ─► P1 Discover & Assess ─► P2 Define To-Be ─► P3 Prepare Factory
                                                              │
     P7 Hypercare & Operate ◄─ P6 Cutover ◄─ P5 Verify ◄─ P4 Migrate (by wave)
```

### P0 — Mobilize
- **Activities**:
  - set up the program/project, team and RACI;
  - choose the SDLC template;
  - define the AI strategy (scope, tools, KPIs);
  - choose the allowed harnesses and models;
  - **bootstrap the project build**: document repo, legacy and target repos registered.
- **Inputs**: statement of work, system list, customer constraints (security, data residency), scaffolded target base (or the plan to build it).
- **Outputs**: project charter, RACI, AI strategy for engineering, KPI baseline, document repo with `kintsugi.yaml` and starter `standards/`.
- **Gate G0**: AI usage policy and tool list approved; document repo and repos declared.

### P1 — Discover & Assess
- **Activities**:
  - Inventory of the environment (apps, infrastructure, dependencies, databases) and of the migration units: drafted by agents from repos and documents, confirmed by people.
  - AS-IS ingestion into the **AS-IS knowledge base**: source code, documents (xlsx/docx → md), knowledge-transfer recordings (transcribed), DB schemas.
  - Generate requirements from KT recordings and the running application. Detect the **gap list** between docs, code and app.
  - Score the **transformation scorecard** (business value, technical value, feasibility, cost, risk; weighted) to get a priority.
  - Recommend a **7R disposition** (Retire / Retain / Rehost / Replatform / Refactor / Re-architect / Rebuild / Repurchase).
  - Group applications by **migration pattern** and build the **wave plan**.
- **Outputs**: inventory, AS-IS KB, AS-IS docs, gap list, scorecard, 7R decision, wave plan.
- **Gate G1**: portfolio decision approved by the steering committee.

#### Reverse engineering the AS-IS system (runtime stages)
The current built-in runtime plans perform application assessment in two stages, each delivered as a pull request to the document repo that a person reviews and merges ([ADR-0027](../decisions/0027-builtin-modernization-content.md), [ADR-0031](../decisions/0031-understand-stage-as-is-specification.md), [ADR-0033](../decisions/0033-assess-catalog-understand-selection.md)):

```
assess (whole application) ─► item catalog ─► understand (selected catalog items; repeatable)
```

The previous `map`, `extract-rules` and `harden` activities are not independent built-in plan stages now; their topology, rule-extraction and security-review work is performed within `assess` and `understand`.

| Stage | Answers | Main outputs |
|---|---|---|
| `assess` | What is there, how big, how risky, and which pieces does it consist of? | `applications/<app>/assessment/inventory.json`, `topology.json`, `analysis/`, `catalog-draft/`, `catalog.json`, `ASSESSMENT.md`, `ARCHITECTURE.mmd`, and `tools/extract_topology.py` |
| `understand` | For each selected catalog item (unit): how does it connect, which rules does it enforce, which risks does it carry, and what does it do end to end? | Per unit, under `applications/<app>/units/<module>/<unit>/`: `{topology.json,rules.json,findings.json}`, `as-is.md`, `{meta.json,trace.json}`, and `unit.md`; plus `applications/<app>/assessment/understand/briefs/` |

**The catalog is the menu.** `assess` groups source files into catalog items from extracted topology (module → item, without code parsing), lets a `legacy-analyst` job curate the grouping, and reconciles ids across re-assessments. A catalog entry id is `<module>/<unit>`; its full unit id is `<app>/<module>/<unit>`. Item status is derived by the API, not stored. See the [item catalog reference](../reference/document-repo-item-catalog.md) for the status values and reconciliation rules.

**Which items first.** A third runtime stage, `plan-understand` ([ADR-0041](../decisions/0041-ai-plan-for-understanding-order.md)), proposes the order: a script builds the item graph (who calls whom, shared data stores, cycles) from the topology, an agent groups the open items into batches with a reason each, and a script checks and measures the batches. The plan is advice committed to `applications/<app>/assessment/understand/plan.json`; the portal shows it above the catalog and selects a batch in one click.

**`understand` runs on a selection.** A person selects catalog items or whole modules; the run maps the selected units, extracts their rules, reviews their security, writes one AS-IS specification per unit and proposes unit state, all in one pull request. Several selections can be in flight at once: each run writes only its selected units' paths, and a unit that is running or in an open pull request cannot be selected again until the pull request is merged or abandoned. A failed run can be retried from where it stopped. After a merge, `rebuild_aggregates.py` regenerates the whole-application files under `applications/<app>/generated/`; the exact filenames are in the [document repository layout](../reference/document-repo.md). These aggregates are separate from the unit files in the run's pull request.

The security review is part of `understand`. Runtime jobs do not run a scanner; the reviewer uses the assessment and topology, and the per-unit findings record cited source files and the limits of the review. `SECURITY_FINDINGS.md` is the rebuilt application-wide view of those findings.

### P2 — Define To-Be
- **Activities**:
  - TO-BE requirements;
  - target architecture (business / application / data / technology);
  - co-existence options (data continuity layer, strangler, monolith → macro → mini → micro-services);
  - buy / build / hybrid;
  - cost-benefit;
  - POC plan;
  - prototype or first working version.
- **Outputs**: target architecture blueprint, ADRs, co-existence strategy, data migration strategy, POC plan, initial TO-BE KB, **standards drafted** in the document repo (target and UI conventions, mappings, review rules).
- **Gate G2**: approved by the **Architecture Review Board**.

### P3 — Prepare Factory
- **Activities**:
  - base source / skeleton, landing zone and IaC, CI/CD;
  - deliverable creation guidelines;
  - **agent plugins (skills, agents, hooks), prompt libraries and task-pack templates** for members' harnesses, per type of work (reverse design, version upgrade, language transformation, unit-test generation, test-case generation, data migration);
  - configure the runtime agents (task-planner, gate-reviewer) and their eval sets;
  - run pilot units and fix the standards where they were unclear or wrong.
- **Outputs**: runnable base source, CI/CD pipeline, piloted agent plugins and task-pack templates, configured runtime agents, complete TO-BE KB.
- **Gate G3**: a pilot of 1–2 units per unit kind meets quality, and the architect confirms the target repos are scaffolded and the standards are written (a human decision; there is no automatic readiness check).

### P4 — Migrate (by wave / feature)
- **Activities**: reverse design (code → detail design), new design generation, code migration/porting, data migration, design ↔ code sync, fixing static-check and runtime errors.
- **How the work is done**:
  1. Members work in their own AI harness, following the **task pack** produced by the runtime.
  2. `gate-reviewer` (runtime) reviews each PR first.
  3. A human approves.
- **Outputs**: new source code, detail designs, migration scripts, PRs.
- **Gate G4** (per unit): green build, static checks, AI code review, human PR approval.

### P5 — Verify (refine + test)
- **Activities**:
  - refine against requirements;
  - unit tests (target ≥ 80–90 % coverage);
  - UI and functional tests;
  - **compare tests** (as-is vs to-be);
  - integration and E2E tests;
  - non-functional tests (performance, security);
  - **migration rehearsal**;
  - UAT.
- **Outputs**: test cases and scripts, test report, defect log, rehearsal report.
- **Gate G5**: test exit criteria met and UAT sign-off.

### P6 — Cutover & Go-live
- **Activities**: deployment readiness checklist, cutover plan, final data sync, go / no-go, decommissioning of the legacy infrastructure.
- **Outputs**: system in production, runbook, rollback plan.
- **Gate G6**: go / no-go.

### P7 — Hypercare & Operate
- **Activities**: monitoring, incident management, AI-generated user manuals and training material, end-user chatbot, FinOps and carbon metrics, KB handover to the maintenance team.
- **Outputs**: hypercare report, handed-over KB, cost and health dashboards.

## 3. Cross-cutting concerns

| Area | Content | In Kintsugi |
|---|---|---|
| **Governance** | Organization alignment, program management, portfolio management, change & release, risk & benefit, upskilling, data curation, cloud financial management, architecture review board | Governance pillar: gates, policies, risk register, audit |
| **Knowledge** | AS-IS KB, TO-BE KB (vector + graph), chatbot, MCP access | Knowledge Hub shared by every phase and every harness |
| **AI metrics** | Coverage, active rate, SDLC coverage, time saved, cost reduction, outcome ratio, AI vs. human defect rate | See [AI metrics](ai-metrics.md) |
| **Workforce / RACI** | PM, core team, dev, QC, BA, AI practice owner, AI champion, AI engineer / prompt engineer, KM lead / engineer | Project roles named in pipelines (open set, ADR-0024); every task has R/A/C/I |

## 4. Pipeline ↔ 7R

Not every application goes through all of P0–P7.
- Each application follows a **pipeline definition**: a built-in one chosen by id, or one declared under `pipelines:` in `kintsugi.yaml`. It lists phases, stages, performers and gates.
- Kintsugi ships one built-in definition per 7R strategy. Projects can declare their own instead: add custom phases (mapped to a built-in category for reporting) or remove stages.

Typical shape of the built-in templates:

| 7R | Heavy phases | Main plugin skills (member harness) / runtime agents |
|---|---|---|
| Retire | P1 → P6 (decommission) | `assessment`, dependency analysis (runtime) |
| Retain | P1 | — |
| Rehost | P1, P3 (IaC), P6 | Infrastructure generation (AWS/Azure), cutover checklist |
| Replatform | P1, P3, light P4 | Version upgrade, container / IaC generation |
| Refactor | Full P1–P5 | Reverse design, version upgrade, unit-test generation, compare test |
| Re-architect | P1–P6 + co-existence | Reverse design, design generation, service extraction, data migration |
| Rebuild | P1–P6, heavy P2/P3 | Business analysis, prototyping, design/code/test generation from the TO-BE KB |
| Repurchase | P1, P2 (vendor fit), P4 data migration | Data migration |

### Transformation scorecard → disposition
The scorecard combines five criteria groups: business, technical, feasibility, cost and risk. Each criterion is scored 1–10 and weighted; the weights sum to 1 (`ScorecardCriterion` in [`packages/domain`](../../packages/domain/src/index.ts)).

The weighted total maps to a priority and candidate dispositions:

| Total | Priority | Candidates |
|---|---|---|
| ≥ 7 | Low | Retain, Rehost |
| 4–7 | Medium | Rehost, Refactor |
| < 4 | High | Retire, Re-architect, Rebuild, Repurchase |

## 5. Implications for Kintsugi

1. **The pipeline is a configurable template** (per 7R and project type), not hard-coded.
2. **A unit** is a feature, screen, module or data object moving through stages. Each unit has a file in the document repo whose frontmatter holds its state (ADR-0012). Each stage is performed by a member (with an AI harness), a runtime agent (preparation / review) or a tool.
3. **The knowledge base is first-class.** Runtime agents and members' harnesses both read it, and merged results flow back into it (continuous TO-BE KB enrichment).
4. **Project knowledge is built, versioned and verified**: standards are written per project in the document repo, changed by PR, and only deliberately copied to other projects.
5. **AI metrics are measured from day one.**
6. **Separate the "brain" from the "hands".** Platform intelligence runs on the Kintsugi Runtime; implementation stays in the harnesses members already use.
7. **Every output is a file in Git**, referenced as `repo@commit:path` ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)).
