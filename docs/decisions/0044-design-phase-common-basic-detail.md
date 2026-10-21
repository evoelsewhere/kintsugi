# ADR-0044: The design phase: common, basic and detail design before implementation

- Status: Accepted (refines P2–P4 of the pipeline; replaces the single `design.md` per unit)
- Date: 2026-10-21
- Decision register: D60

## Context

After `assess` and `understand` the first design of the rebuild described the next steps loosely: P2 "Define To-Be" gathered requirements, architecture and a POC; P4 "Migrate" did "reverse design, new design generation and code generation" in one phase. The `modernize` member plugin followed that shape (`brief`, `reimagine`, `transform`): one brief per application, one design file per unit.

A rebuild team does not work that way. Three things hold in practice:

- A **foundation team** designs what every unit shares: the target architecture, the common components (authentication, logging, error handling, transactions, batch framework, data access), the naming and layering rules, and the skeleton of each target repo. Units reuse it by reference; they do not design it again.
- Each unit is then designed twice, in two different documents for two different readers. The **basic design** says what the unit is: functions, screens, inputs and outputs, data, interfaces, flow. It is needed early for every unit in scope, because scope and waves are planned from it. The **detail design** says how it is built: modules and classes, sequences, queries, validation, error codes and messages. It is written just before the unit is coded, wave by wave, and is precise enough that an AI harness can generate the code from it.
- Only then does implementation start: code and unit tests, reviewed against the detail design, with the design brought back in line when the code differs.

The vocabulary in `packages/domain` and the pipeline stages have no place for this, and the layout has one `design.md` per unit.

## Decision

1. **Four levels of work follow understanding.**

   | Level | Who | Scope | Output |
   |---|---|---|---|
   | Common design and skeleton | the foundation team | project-wide, plus what is specific to an application | the architecture and the common components, each with a stable id (`COM-…`); the scaffolded target repos |
   | Basic design | member (architect, analyst, developer) with their harness | per unit, every unit in scope | the unit's basic-design documents |
   | Detail design | member with their harness | per unit, in its wave | the unit's detail-design documents |
   | Implementation | member with their harness | per unit | code and unit tests in the target repo |

2. **Phase mapping.** P2 holds the common design and the basic design of all units. P3 holds the skeleton, the design templates ([ADR-0045](0045-design-templates-are-project-data.md)) and the pilot: one or two units taken through basic design, detail design and code. In P4 each unit runs `detail-design` → `design-review` → `implement` → `unit-test` → `code-review`, ending in gate G4. Review points between stages use stage gates (`stage:<id>`, already valid gate keys); no new pipeline gate is added. A project that needs another shape declares its own pipeline ([ADR-0043](0043-rebuild-only.md)).

3. **Where documents live** (one place per fact):
   - Common design shared by the project: `architecture/` (the blueprint, and `architecture/common/<component>.md`, one document per common component).
   - Design specific to an application: `applications/<app>/to-be/`.
   - Unit design: `applications/<app>/units/<module>/<unit>/design/<set>/…`, a subfolder of the Unit aggregate next to `understanding/`. This replaces `design.md` at the unit root. The set names and the files in them are defined by the project ([ADR-0045](0045-design-templates-are-project-data.md)).

4. **The foundation team is a project role**, not a new kind of actor. Project roles are an open set ([ADR-0024](0024-access-roles-vs-project-roles.md)): a project names it (for example `foundation`) in the pipeline as the performer of the common-design stages.

5. **Authorship stays with members.** Design is written by people in their own harness and reaches the document repo through a pull request. The Kintsugi Runtime does not write to project repos; it prepares and reviews: `plan-design` proposes the order (common design first, then units by dependency and wave, reusing the item graph of [ADR-0041](0041-ai-plan-for-understanding-order.md)); `design-review` checks a design against its template and against the unit's understanding before a person reviews it. Both are later work; this decision fixes the contract they rely on.

6. **Traceability extends to design.** The chain `rule → requirement` becomes `rule → requirement → design item → code → test`. Design items carry stable ids in the documents' tables; a unit refers to common components by their `COM-…` id; the review can therefore check that every business rule of the unit is addressed and every reference resolves.

7. **The `modernize` member plugin is reorganized around this lifecycle.**
   - `modernize-brief` and the architecture part of `modernize-reimagine` become common design; the scaffolding becomes its own stage.
   - A generic `design` command writes one design set for one unit from its template; `modernize-transform` becomes `implement` (code and unit tests from the detail design).
   - The other transformation strategies of the plugin (`uplift`, `preflight`, the version-delta and uplift agents, scripts and workflows) are removed, consistent with [ADR-0043](0043-rebuild-only.md).

## Consequences

- Design is reviewable at two levels of detail, by the right people: the basic design by architects and analysts when scope is set, the detail design by the team that codes, close to the work.
- The common design is a prerequisite: no unit's detail design starts before the components it references exist. The pipeline and `plan-design` can express this order.
- The layout changes: `design.md` at the unit root is replaced by `design/<set>/`. Nothing is migrated: the app has no users, and no writer of `design.md` exists yet.
- `to-be/requirements.md` and `to-be/design.md` per application remain; their template content is revised to name only what is application-specific.
- The pipeline documentation, the document-repo reference, the starter repo and the `modernize` plugin need to be updated; the plan and its order are tracked with this decision.
- Risks: the template and the check vocabulary of ADR-0045 decide how useful this is; a project with a very different breakdown (more levels, a design per screen and per table) is covered by defining its own sets and pipeline, not by changing Kintsugi.

## Alternatives considered

- **One design phase per unit with one document.** What exists today. It hides the difference between scope-setting design and build-ready design, and gives reviewers one large document at the wrong time; rejected.
- **Hard-code basic and detail in the engine.** Simple to build, but a project's levels, documents and wording differ; covered instead by project-defined sets ([ADR-0045](0045-design-templates-are-project-data.md)); rejected.
- **A runtime agent writes the designs.** Conflicts with the rule that runtime jobs never write to project repos and removes the member's judgement from the step that most needs it; rejected. The runtime reviews and plans.
