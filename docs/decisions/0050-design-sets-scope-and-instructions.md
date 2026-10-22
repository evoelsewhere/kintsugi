# ADR-0050: Design sets can be scoped to the application and carry their own instructions

- Status: Accepted (extends [ADR-0045](0045-design-templates-are-project-data.md) and [ADR-0049](0049-design-sets-generated-by-the-runtime.md); the application design folder is `10-applications/<app>/02-modern/_design/<set>/` since [ADR-0051](0051-document-repo-layout-legacy-and-modern.md); `appliesTo` and `When` are replaced by profiles in [ADR-0053](0053-design-template-profiles-by-unit-kind.md))
- Date: 2026-10-21
- Decision register: D66

## Context

A design type is a folder under `standards/design/` ([ADR-0045](0045-design-templates-are-project-data.md)) and the portal generates a set for a selection of units ([ADR-0049](0049-design-sets-generated-by-the-runtime.md)). Two limits kept the Design stage from being as dynamic as a project needs:

- A set was always **per unit**. A design that belongs to the whole application (an architecture overview, a database design, an interface list) had no place: it could not be generated, checked or shown, so it stayed outside the stage.
- How a type is generated could not be shaped per type. One generic `designer` agent, with guidance only inside the comments of the templates: no way to say "also read these documents" or to tell the designer how this kind of design is written.

## Decision

1. **A set has a scope**: `scope: unit` (the default, as before) or `scope: application` in the front matter of `set.md`. A set of scope `application` is one design for the whole application, written once under `applications/<app>/design/<set>/` (unit sets stay under `units/<module>/<unit>/design/<set>/`). `project` is reserved for later; the common design (`architecture/`, the `COM-…` components, gate G2) is not a set and stays with members.

2. **The application is addressed as the pseudo-unit `@app`** wherever a unit key goes: the scope of a design run, the scaffold's manifest, the check report, the activity of the portal. The stage plan, the writer and the run views stay uniform; a run for an application set has exactly one item.

3. **Rules for a set of the application**, reported as faults of the set by both implementations of the reader (the TypeScript reader the API runs and `design_lib.py`):
   - `appliesTo` and the `When` column must be empty (an application has no unit kind);
   - `needs` may name only sets of the application (a unit set may need a unit set or an application set);
   - a template may not use `{{unit.id}}`, `{{unit.title}}`, `{{kind}}`, `seed: rules`, `check: covers-rules` or `refs-resolve(… -> rules)`: rules are per unit. `refs-resolve` may use `requirements`, `components` or a set it needs.

4. **A unit set may need an application set.** The design items of an application set resolve for the unit designs that need it, so a detail design can point to the identifiers of the application's architecture. A unit's set is not ready to generate until the application set it needs is on the default branch.

5. **A set can carry its own instructions and reads.** In `set.md`: `reads`, a list of document-repository paths or folders (`{app}` allowed, relative, no `..`) the designer also reads, and a body section `## Instructions` addressed to the designer (excluded from the description shown to people). The scaffold's manifest carries `scope` and `reads`; the stage gives the designer the documents `reads` names and tells it to follow the Instructions. Which agent or model runs is not per set (the `designer` agent and its binding, [ADR-0049](0049-design-sets-generated-by-the-runtime.md)).

6. **The portal shows the choice before it is made.** Choosing a set on the Units tab shows what it is for (every unit, a kind, or the application), its documents, what it needs and what it also reads; for a set of the application the table is replaced by a card with its state and the Generate button, and its documents open in the same drawer as a unit's (`@app`). The overview lists the application among what is ready to design.

## Consequences

- A project adds a design type by adding a folder (`set.md` and templates) in a pull request: if its scope is `application` it appears, with its state and a Generate button, without a release; if it needs another set, the order of work follows.
- The reader, the scripts, the API and the portal gain one more dimension. The two parsers stay equal through shared fixtures (`app-sets/`, `bad-app-sets/`, `appCases`); `check_design.py --report` always writes the multi-unit form so the stage reads one shape.
- Limits accepted: no `project` scope, no per-set agent or model, one set per run, no regeneration of an existing design, no waivers for the application's design.
- Risk: an application design that reads too much; `reads` is a convenience of the project, and the cap on output size of the writer and the agent budget stay the bounds.

## Alternatives considered

- **Treat the application as a unit with a special key in the unit folders.** No new path layout, but the application's design would sit among the units' folders and be mistaken for one.
- **A separate stage for application designs.** Duplicates the stage, the run views and the portal page; one stage with a scope keeps one way to generate.
- **Instructions inside the templates only.** Works for the shape of a document, not for what to read or how to approach the whole set; kept for guidance of sections, added at the set level.
- **Per-set agent or model.** Useful, but it multiplies bindings and tests; deferred until a project needs it.
