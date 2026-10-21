# Document repo contexts

> The document repo, read as bounded contexts around the unit. Decision: [ADR-0042](../../decisions/0042-markdown-only-document-repo-by-bounded-context.md). Formats: [Document formats](../../reference/document-formats.md).

A project's document repo holds everything except code ([ADR-0028](../../decisions/0028-remove-rulebook-single-document-repo.md)). Its folders are not stages or tools but the **contexts** of the method: each answers one question, owns its documents and its words, and is written by one kind of job. The **unit** is the aggregate that the contexts share.

## Context map

```mermaid
flowchart LR
  inputs["Inputs<br/>what people attach"]
  assessment["Assessment<br/>what is the estate?"]
  understanding["Understanding<br/>what does it do?"]
  unit(["Unit aggregate<br/>unit.md is the root"])
  templates[("standards/design/<br/>the project's templates")]
  common[("architecture/<br/>common design, COM- components")]
  design["Design<br/>what are we building?"]
  implementation["Implementation<br/>code and unit tests"]
  governance["Governance<br/>who decided?"]
  generated[("generated/<br/>read models")]

  inputs --> assessment
  assessment -->|"catalog items"| understanding
  understanding -->|"understanding/"| unit
  unit --> design
  templates -->|"format and checks"| design
  common -->|"reused by id"| design
  design --> implementation
  implementation -->|"evidence"| governance
  understanding -->|"rebuild after merge"| generated
  governance -.->|"gate records"| unit
```

| Context | Folder | Owns | Written by |
|---|---|---|---|
| Inputs | `applications/<app>/inputs/` | `INTENT.md`, `graph/`, `telemetry/` | people |
| Assessment | `applications/<app>/assessment/` | the inventory, the topology, the item **catalog**, `ASSESSMENT.md`, the extraction script | the `assess` stage |
| Understanding | `applications/<app>/understanding/`, `units/<module>/<unit>/understanding/` | the plan of what to read next; per unit the AS-IS specification, rules, data objects, verdicts, findings, topology, trace and the understanding record | the `plan-understand` and `understand` stages; people for `rules-review.md` |
| Design | `architecture/` (with `common/`), `to-be/`, `units/…/design/<set>/`, `standards/design/` | the common design and its components, the application's requirements and design, each unit's design documents, and the project's templates for them ([ADR-0044](../../decisions/0044-design-phase-common-basic-detail.md), [ADR-0045](../../decisions/0045-design-templates-are-project-data.md)) | member harnesses; people for the templates |
| Implementation | `units/…/task.md`, the target repositories | the task pack; the code and its unit tests | member harnesses |
| Governance | `gates/`, `units/…/reviews/` | gate records | people, through pull requests |
| Read models | `applications/<app>/generated/` | aggregates rebuilt from the units after a merge | the rebuild script, auto-committed |

Contexts talk through the aggregate and the catalog, never through each other's files: the planning stage reads the catalog cards, not the topology.

## The Unit aggregate

`applications/<app>/units/<module>/<unit>/` is one aggregate. `unit.md` is its root: the state, the gates and the links, changed through the API. Each context writes into its own subfolder (`understanding/`, `design/`), so a pull request of one context never touches another's documents.

An **item** is a catalog entry (`<module>/<item>`); it becomes a **unit** (`<app>/<module>/<unit>`) when it is selected for understanding. Item status (`not-analysed`, `running`, `in-pr`, `failed`, `understood`, `stale`, `retired`) is derived, never stored: `understood` is the presence of `understanding/understanding.md` on the default branch, `stale` is a digest that moved.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Application | One legacy system with a repository; `applications/<app>/` |
| Module | A domain of the topology; the first segment of an item id |
| Item | A catalog entry, two levels (module → item); what a person selects for analysis |
| Unit | An item once selected; the aggregate with a full id `<app>/<module>/<unit>` |
| Leaf | A node of the extracted topology (a program, job, screen) or a data store |
| Catalog | The set of items of an application, with their links; `assessment/catalog/` |
| Understanding record | `understanding.md`: digest, commit and run an item was understood at |
| Plan | `understanding/plan.md`: batches of items to understand next, advice replaced by every planning run |
| Rule, finding | Items of the AS-IS knowledge with stable ids (`RULE-<module>.<unit>-<hash>`, `SEC-<module>.<unit>-NN`) |
| Verdict | A person's `confirmed`, `refuted` or `clarify` on a rule, in `rules-review.md` |
| Design set | A group of documents written together for a unit (`basic`, `detail`, …); defined by the project in `standards/design/<set>/` |
| Common component | Something every unit reuses, designed once by the foundation team: `architecture/common/COM-<AREA>-<NN>.md` |
| Design item | A row with an `ID` in a unit's design document; a later set refers to it by id |
| Read model | A document rebuilt from the units; never edited by hand |
| Scratch | The JSON a run passes between its steps; never committed |
