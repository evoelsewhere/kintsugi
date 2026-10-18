<p align="center">
  <img src="assets/brand/kintsugi-mark-light.svg" width="96" alt="Kintsugi" />
</p>

# Kintsugi

**AI-driven application migration & modernization portal** — orchestrates the full journey from as-is to to-be architecture: Mobilize → Discover & Assess → Define To-Be → Prepare Factory → Migrate → Verify → Cutover → Hypercare.

- **Common engine, project-built rules**: Kintsugi is stack-agnostic. Each project keeps everything except code in one **document repo**: `kintsugi.yaml` (repos and pipelines), its standards (target conventions, mappings, review rules) as plain documents, and its member plugins.
- **Four pillars**: Admin · Delivery · Monitoring · Governance, on a shared core (Workflow Orchestrator, Knowledge Hub, Standards & Assets, Kintsugi Runtime, Harness Hub, Git Sync & Writer).
- **Kintsugi Runtime on [pi](https://github.com/earendil-works/pi)**: Kintsugi's own agents (knowledge, assessment, wave planning, to-be analysis, task planning, gate review, insight) run server-side in sandboxes and never write to project repos.
- **Members implement with their own harnesses**: Claude Code, GitHub Copilot and ChatGPT/Codex on members' machines. They get task packs, skills and the KB through the Kintsugi MCP server and CLI; Kintsugi collects PRs, artifacts and telemetry back for gates and AI metrics.

## Two agent worlds

The platform never drives implementation work itself. **Kintsugi's own agents** run server-side as read-only jobs; **members** implement in the harnesses they already use. Everything meets in Git: outputs are files in the document repo, implementation is pull requests in project repos.

![Two agent worlds — stage jobs and the Kintsugi Runtime run server-side in sandboxes; members implement in their own harnesses; both sides meet in Git while a person starts stages and decides gates](assets/diagrams/two-agent-worlds.png)

## Delivery pipeline

A project moves through **P0–P7**, each phase configured by the application's 7R strategy. Every phase is closed by a **gate** — a person's decision backed by evidence in Git.

![Delivery pipeline — phases P0 to P7 on the Kintsugi platform lane, each closed by a person-decided gate G0 to G6 before the next phase starts](assets/diagrams/delivery-pipeline.png)

Details: [delivery pipeline](docs/methodology/delivery-pipeline.md) · [AI metrics](docs/methodology/ai-metrics.md).

## Inside one stage

What a stage looks like end to end — example: **P1 Discover & Assess**. A person starts it in the portal; Kintsugi runs it as jobs, read-only on source, writing only to the job workspace; the result arrives as a pull request a person reviews and merges. Script steps and AI reasoning steps alternate, handing off inventory, topology, catalog and assessment files along the payload chain.

![Inside one stage — a P1 Discover and Assess job alternates script steps and AI reasoning steps across the payload chain until a person reviews and merges the pull request](assets/diagrams/inside-a-stage.png)

## Platform at a glance

![Platform at a glance — four abstraction layers from experience down to data, with the core platform as the focal pay-rent layer](assets/diagrams/platform-at-a-glance.png)

## Docs

Start at the [documentation map](docs/README.md). It is organized by purpose (Diátaxis), with arc42 for architecture and ADRs for decisions.

| Section | Content |
|---|---|
| [Product](docs/product/) | [Overview](docs/product/overview.md), [roadmap](docs/product/roadmap.md) |
| [Methodology](docs/methodology/) | [Delivery pipeline](docs/methodology/delivery-pipeline.md) (P0–P7, gates, 7R), [AI metrics](docs/methodology/ai-metrics.md) |
| [Architecture](docs/architecture/README.md) | arc42 chapters 1–11 and crosscutting concepts |
| [Decisions](docs/decisions/README.md) | Decision register and ADRs |
| [Reference](docs/reference/) | Glossary, runtime agents, harness integration, data model, document repo, configuration |
| [Guides](docs/guides/) | Installation, build a project, LLM providers, member workflow |

## Layout

```
apps/        portal (React SPA) · api (REST + OpenAPI)
services/    orchestrator (pg-boss jobs, git sync/writer) · knowledge (KB) · runtime (generic agent kernel on pi + launcher) · harness-hub (MCP, CLI API, asset render, telemetry)
packages/    domain · manifest · agents (agent packages; builtin plugins: understand, modernize) · git · runtime-sdk · harness-sdk · secrets
templates/   document repo starter template (neutral standards and plugin samples)
deploy/      Docker Compose package
assets/      brand marks · README diagrams (HTML sources + PNG exports)
docs/        documentation (Diátaxis) & ADRs
```

## Deployment model

Kintsugi ships as a **self-hosted package**: each project runs it with Docker Compose on its own host (no Kubernetes). Git is the source of truth for code and documents; Postgres (with pgvector) is the only datastore. See the [deployment view](docs/architecture/07-deployment-view.md) and the [installation guide](docs/guides/installation.md).

## Development

Requires Node ≥ 22 and pnpm 10.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
make dev      # API on :3000 + worker, portal on :5173
```
