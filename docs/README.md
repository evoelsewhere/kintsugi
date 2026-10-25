# Kintsugi documentation

The documentation is organized by **what the reader needs**, following [Diátaxis](https://diataxis.fr/). Architecture follows [arc42](https://arc42.org/), and decisions are recorded as [ADRs](https://adr.github.io/).

| Section | Type | Read it when you want to… |
|---|---|---|
| [product/](product/) | Explanation | understand what Kintsugi is, why it exists, and where it is going |
| [methodology/](methodology/) | Explanation | understand the migration delivery method Kintsugi supports |
| [architecture/](architecture/) | Explanation (arc42) | understand how the system is designed, and why |
| [decisions/](decisions/) | Record | see what was decided, what is still open, and the ADRs |
| [reference/](reference/) | Reference | look up exact facts: agents, MCP tools, CLI, data model, repo layout, configuration, terms |
| [guides/](guides/) | How-to | accomplish a task: install, configure, work on a migration task |
| [development/](development/) | Delivery record | review implementation status, plans, open work, and verification evidence |

Tutorials (learning-oriented walkthroughs) will be added once a first release exists.

## Map

**Product**
- [Overview](product/overview.md): problem, scope, what Kintsugi is and is not
- [Roadmap](product/roadmap.md): milestones M0–M5

**Methodology**
- [Delivery pipeline](methodology/delivery-pipeline.md): phases P0–P4, gates, scorecard priority
- [AI metrics](methodology/ai-metrics.md): definitions, targets, data sources

**Architecture** ([index](architecture/README.md))

| arc42 section | Document |
|---|---|
| 1 | [Introduction and goals](architecture/01-introduction-and-goals.md) |
| 2 | [Constraints](architecture/02-constraints.md) |
| 3 | [Context and scope](architecture/03-context-and-scope.md) |
| 4 | [Solution strategy](architecture/04-solution-strategy.md) |
| 5 | [Building block view](architecture/05-building-block-view.md) |
| 6 | [Runtime view](architecture/06-runtime-view.md) |
| 7 | [Deployment view](architecture/07-deployment-view.md) |
| 8 | [Crosscutting concepts](architecture/08-crosscutting-concepts.md) (runtime & harnesses, Git as source of truth, security, identity, LLM configuration, observability) |
| 9 | [Decisions](decisions/README.md) |
| 10 | [Quality requirements](architecture/10-quality-requirements.md) |
| 11 | [Risks and technical debt](architecture/11-risks-and-technical-debt.md) |
| 12 | [Glossary](reference/glossary.md) |

**Decisions**
- [Decision register and ADR index](decisions/README.md)
- [ADR template](decisions/template.md)

**Reference**
- [Glossary](reference/glossary.md)
- [Runtime agents](reference/runtime-agents.md): job contract, agent definition, kernel tools, events
- [Debug MCP server](reference/debug-mcp.md): the read-only tools of a development installation over runs, sandboxes, logs, queues and the database (ADR-0056)
- [Job workspace](reference/job-workspace.md): the layout of a job's workspace, the guide, attempts, the ledger and the lifecycle (ADR-0055)
- [Data model](reference/data-model.md)
- [Document repository layout](reference/document-repo.md): the numbered layout, each application split into legacy and modern (ADR-0051), who writes what and auto-commit
- [Document formats](reference/document-formats.md): the Markdown shapes of every committed document (front matter, tables, cards)
- [Document repo contexts](architecture/concepts/document-repo-contexts.md): the context map, the Unit aggregate and the ubiquitous language
- [Manifest schema](reference/document-repo-manifest.md): `kintsugi.yaml`
- [Document identifiers](reference/document-identifiers.md): compact stable RULE, SEC and GAP references, scope allocation and ledgers
- [Item catalog](reference/document-repo-item-catalog.md): catalog items, stable IDs, and the units they become
- [Document write path](reference/document-repo-write-path.md): job outputs, branches and pull requests
- [Document reads and stage results](reference/document-repo-read-path.md): file APIs and result views
- [Commit conventions](reference/document-repo-commit-conventions.md): identity, trailers and auto-commit defaults
- [Unit files](reference/document-repo-unit-files.md): the unit directory, unit state, rule verdicts and traceability
- [Design templates](reference/design-templates.md): design sets, template directives, checks, conformance (ADR-0044, ADR-0045)
- [Specification profiles](reference/specification-profiles.md): the sections of an AS-IS specification by item kind (ADR-0060)
- [Configuration](reference/configuration.md): installation environment variables

**Guides**
- [Install Kintsugi](guides/installation.md)
- [Build a project (register repos, write standards)](guides/build-project.md)
- [Define a project's design templates](guides/define-design-templates.md)
- [Configure LLM providers for the runtime](guides/configure-llm-providers.md)

**Delivery record**
- [Member CLI and local MCP bridge](reference/member-cli.md): install the CLI, connect a client, sign in, add plugins, read projects and documents
- **Guideline**: the portal page `/guideline` on every installation (quick start, install, connect, plugins, reference)
- [Member client compatibility](reference/member-client-compatibility.md): tested client versions and setup probes
- [Member client capabilities](reference/member-client-capabilities.md): what Claude Code, Codex and GitHub Copilot support for plugins, hooks and transcripts
- [Implementation and verification record](development/implementation-delivery-record.md): the deployment work, its status and evidence; remaining release work

## Conventions

- **Language**: English. Keep documents neutral: no customer, vendor-internal or company-specific references.
- **One purpose per document.** Do not mix how-to steps into explanation pages; link instead.
- **Single source of truth.** Facts live in one place (usually `reference/` or an ADR); other pages link to them rather than repeating them.
- **File names**: lowercase kebab-case. arc42 chapters keep their number prefix.
- **Decisions**: any change to architecture, infrastructure dependencies or contracts needs an ADR (copy [template.md](decisions/template.md)) and an update to the [decision register](decisions/README.md).
- **Status markers**: ✅ decided · 🟡 proposed · ⬜ open · ❓ open point inside a page (with its decision ID, e.g. D29).
- **Product not implemented yet**: guides describe planned behavior and say so at the top.
