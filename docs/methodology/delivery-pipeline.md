# Delivery pipeline

This page explains the migration delivery method Kintsugi supports. How the system implements it is described in the [architecture](../architecture/README.md).

## 1. The big picture

An as-is → to-be migration project combines three layers:

| Layer | Content | What Kintsugi does |
|---|---|---|
| **Factory** | Strategy & mobilization, solution enablement, operation & control, core infrastructure / automation, migration tools, verification, post-migration support, with **governance** across all of them | The module structure of the portal |
| **Lifecycle** | Discover → Requirement / Preparation → Migrate → Refine → Test → Go-live / Hypercare | Workflow engine: phase → stage → task, with quality gates |
| **Workforce** | Humans and AI working together: AI does the first pass, humans review and finish. New AI roles join the RACI (AI champion, AI engineer, prompt engineer, KM lead/engineer, AI practice owner) | RACI-based permissions and human-in-the-loop. The Kintsugi Runtime prepares and reviews; members implement with their own AI harnesses |

The key idea: **invest first in the knowledge base and the skill/prompt library, then run migration at scale** ("design for auto-migration").

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
  - choose the allowed harnesses and models.
- **Inputs**: statement of work, system list, customer constraints (security, data residency).
- **Outputs**: project charter, RACI, AI strategy for engineering, KPI baseline.
- **Gate G0**: AI usage policy and tool list approved.

### P1 — Discover & Assess
- **Activities**:
  - Auto-discovery of the environment: apps, infrastructure, dependencies, databases.
  - AS-IS ingestion into the **AS-IS knowledge base**: source code, documents (xlsx/docx → md), knowledge-transfer recordings (transcribed), DB schemas.
  - Generate requirements from KT recordings and the running application. Detect the **gap list** between docs, code and app.
  - Score the **transformation scorecard** (business value, technical value, feasibility, cost, risk; weighted) to get a priority.
  - Recommend a **7R disposition** (Retire / Retain / Rehost / Replatform / Refactor / Re-architect / Rebuild / Repurchase).
  - Group applications by **migration pattern** and build the **wave plan**.
- **Outputs**: inventory, AS-IS KB, AS-IS docs, gap list, scorecard, 7R decision, wave plan.
- **Gate G1**: portfolio decision approved by the steering committee.

### P2 — Define To-Be
- **Activities**:
  - TO-BE requirements;
  - target architecture (business / application / data / technology);
  - co-existence options (data continuity layer, strangler, monolith → macro → mini → micro-services);
  - buy / build / hybrid;
  - cost-benefit;
  - POC plan;
  - prototype or first working version.
- **Outputs**: target architecture blueprint, ADRs, co-existence strategy, data migration strategy, POC plan, initial TO-BE KB.
- **Gate G2**: approved by the **Architecture Review Board**.

### P3 — Prepare Factory
- **Activities**:
  - base source / skeleton, landing zone and IaC, CI/CD;
  - deliverable creation guidelines;
  - **skill packs, prompt libraries and task-pack templates** for members' harnesses, per type of work (reverse design, version upgrade, language transformation, unit-test generation, test-case generation, data migration);
  - configure the runtime agents (task-planner, gate-reviewer) and their eval sets.
- **Outputs**: runnable base source, CI/CD pipeline, piloted skill packs and task-pack templates, configured runtime agents, complete TO-BE KB.
- **Gate G3**: a pilot of 1–2 features done in members' harnesses meets quality; runtime agents pass their eval thresholds.

### P4 — Migrate (by wave / feature)
- **Activities**: reverse design (code → detail design), new design generation, code migration/porting, data migration, design ↔ code sync, fixing static-check and runtime errors.
- **How the work is done**:
  1. Members work in their own AI harness, following the **task pack** produced by the runtime.
  2. `gate-reviewer` (runtime) reviews each PR first.
  3. A human approves.
- **Outputs**: new source code, detail designs, migration scripts, PRs.
- **Gate G4** (per work item): green build, static checks, AI code review, human PR approval.

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
| **Workforce / RACI** | PM, core team, dev, QC, BA, AI practice owner, AI champion, AI engineer / prompt engineer, KM lead / engineer | Admin role model; every task has R/A/C/I |

## 4. Pipeline ↔ 7R

Not every application goes through all of P0–P7. The 7R strategy selects the pipeline template:

| 7R | Heavy phases | Main skill packs (member harness) / runtime agents |
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
2. **The unit of work is a work item** (feature / screen / module / DB object) moving through stages. Each stage is performed by a member (with an AI harness), a runtime agent (preparation / review) or a tool.
3. **The knowledge base is first-class.** Runtime agents and members' harnesses both read it, and merged results flow back into it (continuous TO-BE KB enrichment).
4. **Assets need versioning and evaluation**: skill packs, prompt libraries, task-pack templates and runtime agents are reused across projects.
5. **AI metrics are measured from day one.**
6. **Separate the "brain" from the "hands".** Platform intelligence runs on the Kintsugi Runtime; implementation stays in the harnesses members already use.
7. **Every output is a file in Git**, referenced as `repo@commit:path` ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)).
