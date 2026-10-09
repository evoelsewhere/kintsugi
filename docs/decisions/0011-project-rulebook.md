# ADR-0011: Every project builds its own rulebook before running the pipeline

- Status: Accepted. Structure amended by [ADR-0013](0013-composable-open-rulebook.md) (packs, open capabilities, declarative pipelines, scoped maturity, waivers, vendoring).
- Date: 2026-10-09
- Decision register: D34, D35

## Context
Kintsugi is a common tool. The engine, runtime agents and method skills are stack-agnostic. What makes a migration succeed is project-specific knowledge, and none of it can be shipped generically:
- the source → target stack pair;
- what a "unit" is;
- how to parse the legacy code;
- the conventions of the already-scaffolded target base;
- construct and UI-pattern mappings;
- the rules reviewers enforce;
- how outputs are compared for equivalence.

Running generic agents on a project that has not encoded this knowledge produces inconsistent, unreviewable results: N units converted N different ways.

## Decision
- **Applying Kintsugi to a project starts with a build step.** The team shapes the project by building a **rulebook**. See the [concept](../architecture/concepts/project-rulebook.md), [reference](../reference/rulebook.md) and [guide](../guides/build-project.md).
- **The rulebook is a project artifact.**
  - It lives only in the project's workspace repo under `rulebook/`.
  - It is pinned by `kintsugi.yaml` (`rulebook: {id, version}`).
  - It is versioned in Git and changed through PRs (ADR-0007).
- **Kintsugi ships no stack-specific catalog.**
  - It ships a neutral **starter template** (`templates/workspace/`) with every capability at maturity `template`.
  - Reuse across projects is a deliberate copy/adapt from another project or an organization's rulebook library, recorded as `derivedFrom`. Kintsugi never silently distributes or upgrades rulebooks.
- **Capabilities have a maturity.**
  - Levels: `template` → `draft` → `ready`.
  - A pipeline stage that depends on a capability runs only when that capability is `ready`.
  - Pilot units may run on `draft`, and each such run is recorded.
  - Promotion to `ready` happens by PR, approved by the owning roles, after verification on pilot units.
- **Gates**: Gate G3 (Prepare Factory) requires every capability needed by the project's pipeline template to be `ready`.
- **Provenance**: every runtime job and task pack records the rulebook `id@version` and the workspace-repo commit it used.
- **Rulebook scripts** (`runners/`) are project code. They execute only in isolated job containers (ADR-0004), never in the worker or the app.
- **Builtin assets**: Kintsugi's builtin runtime agents and member skills stay stack-agnostic. The rulebook adds the stack-specific layer on top.
  - Runtime agents read the rulebook as input.
  - Member harnesses receive the rulebook's plugins (skills, agents, hooks) and conventions through the generated project marketplace (ADR-0015).

## Consequences
- Every project gets an explicit "shaping" phase with a visible definition of done, instead of tuning prompts ad hoc.
- Decisions that cause conflicts when made per unit are taken once, up front, in one reviewed place: conventions, UI patterns, mappings, acceptable differences.
- The rulebook schema becomes a contract (`schemaVersion`) and must stay backward compatible or migrate.
- More upfront work per project. This is mitigated by copy/adapt from earlier projects and by a guided build flow in the portal.
- Supersedes the `.kintsugi/assets/` override mechanism (D28): project-specific assets now live in `rulebook/`.
