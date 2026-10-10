# 1. Introduction and goals

## 1.1 Requirements overview

Kintsugi is an application portal that orchestrates migration and modernization from as-is to to-be architecture ([product overview](../product/overview.md)). Its key capabilities:

- **Project build.** Each project shapes Kintsugi to its stack pair through a verified **rulebook** before the pipeline runs ([project rulebook](concepts/project-rulebook.md)).
- **Configurable delivery pipeline.** Phases P0–P7 with gates, configured per application by its 7R strategy ([delivery pipeline](../methodology/delivery-pipeline.md)).
- **Four pillars.** Admin, Delivery, Monitoring and Governance ([building block view](05-building-block-view.md)).
- **Kintsugi Runtime.** Built on pi, it runs the platform's own agents: knowledge, assessment, planning, gate review, insight.
- **Harness Hub.** Members implement with their own AI harnesses (Claude Code, GitHub Copilot, ChatGPT/Codex). The Harness Hub supplies them with context and collects results and telemetry.
- **AI metrics.** Measured across the project ([AI metrics](../methodology/ai-metrics.md)).

## 1.2 Quality goals

| Priority | Quality goal | Meaning for Kintsugi |
|---|---|---|
| 1 | **Security of customer code** | Customer code is read-only for the runtime, every job is isolated in its own container, egress is restricted, and credentials are never written to disk |
| 2 | **Simple deployability** | A project installs and operates Kintsugi on one Docker host with `docker compose up`; Postgres is the only stateful service |
| 3 | **Traceability** | Every artifact, KB entry and gate decision references `repo@commit:path`; audit is append-only |
| 4 | **Harness neutrality** | Members keep their existing AI tools; assets are packaged once as agent plugins and installed natively, or rendered where plugins are unsupported |
| 5 | **Data ownership and rebuildability** | Git is the source of truth; the KB index can be rebuilt from Git |
| 6 | **Consistency across parallel work** | Stack-specific decisions are made once in the rulebook and verified before work is parallelized; stages refuse to run on unverified rules |

Measurable scenarios for these goals are in [10. Quality requirements](10-quality-requirements.md).

## 1.3 Stakeholders

| Stakeholder persona | Expectations |
|---|---|
| Installation admin / ops | Easy install, upgrade and backup; clear host requirements; restricted blast radius |
| PM / program manager | Pipeline progress, gates, AI metrics, risks in one place |
| Business analyst | AS-IS knowledge with citations, gap lists, requirement drafts |
| Architect / ARB | Scorecards, 7R recommendations, to-be analysis, reviewable ADRs |
| Developer / QC | Task packs and KB access inside their own harness; fast, consistent PR feedback |
| AI champion / AI engineer / prompt engineer | Author rulebook plugins and task-pack templates; bind models to runtime agents; evaluate; see runtime traces |
| KM lead / KM engineer | Control ingestion and quality of the AS-IS / TO-BE KB |
| AI practice owner | Adoption and AI metrics across members and harnesses |
| Customer security officer | Proof that code stays within approved systems, LLM providers are controlled, and actions are audited |
