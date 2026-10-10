# Project rulebook

**Decisions:**
- [ADR-0011](../../decisions/0011-project-rulebook.md): every project builds its rulebook.
- [ADR-0013](../../decisions/0013-composable-open-rulebook.md): composable, open structure.
- [ADR-0014](../../decisions/0014-no-code-graph-no-agent-config.md): no parsing, no unit-discovery or agent configuration.

**See also:** [rulebook reference](../../reference/rulebook.md) for the structure · [build a project](../../guides/build-project.md) for the how-to.

## Why a project must be built

Kintsugi is a **common engine**: pipeline engine, runtime agents, Harness Hub, gates and metrics are the same for every project. A migration, however, succeeds or fails on knowledge that is specific to one engagement:

| Question | Example answers |
|---|---|
| What are we migrating, to what? | VB6 → .NET 8; WebForms → ASP.NET Core; COBOL batch → Java 21. Often several pairs in one portfolio |
| What is a unit of work? | screen, batch job, program, API endpoint, stored procedure, table |
| What should readers of the legacy code know? | source quirks, encodings, naming habits, where business logic hides (agents read the code directly) |
| What does the target base look like? | layering, naming, framework idioms, build/CI, UI kit |
| How does each legacy construct map? | `PERFORM` → method, copybook → DTO, form → page template |
| What does a reviewer reject? | architecture rules, forbidden APIs, UI-kit-only components |
| How do we prove equivalence? | canonicalization profiles, runners and comparators with the right toolchain |
| Which stages do we run? | the project's own pipeline: phases, stages, performers, gates |

If these answers are not written down **before** work is parallelized, every member and every agent decides them again, and N units come out N different ways. The **rulebook** is where a project writes them down. **Building the project** means creating, adapting and verifying it.

## Shape of the rulebook

```
rulebook.yaml ── extends (vendored) ── packs ── pipelines ── harnesses ── waivers
                                         │
                       packs/<stack pair or concern>/  (+ overrides/<app>/<module>/)
```

- **A project artifact.** It lives in the workspace repo, is versioned in `rulebook.yaml`, and changes through PRs like code.
- **Packs.**
  - One pack per stack pair (e.g. `webforms-to-aspnetcore`) or concern (e.g. `org-baseline`, `security`).
  - Each application selects the packs that apply to it, so a portfolio with several stack pairs is one rulebook with several packs.
- **Layers.** Precedence, lowest to highest: vendored → packs → application overrides → module overrides.
  - Rules merge by ID; files merge by path.
  - Kintsugi shows each unit's **resolved view**, including which layer every rule came from.
- **Pipelines.** The project's stages, with their performers, required capabilities and gates, are declared in the rulebook. Built-in pipelines are only templates to copy.
- **Not a shipped catalog.**
  - Kintsugi provides a neutral starter template.
  - Reuse is explicit: **vendor** a pinned snapshot with `extends` (and upgrade it with a reviewed PR), or copy/adapt.
  - Nothing is distributed or upgraded silently.

## Capabilities, maturity and waivers

- **Capabilities** group the rules a stage depends on. Kintsugi knows seven well-known ones (`understand`, `conventions`, `mapping`, `convert`, `review`, `compare`, `cutover`). Projects add their own, e.g. `data-migration` or `security`.
- **Who needs them**: a pipeline stage declares the capabilities it needs (`requires`).
- **Maturity**: each pack declares a maturity per capability, scoped per unit kind or application when needed:

```
template ──adapt──► draft ──verify on pilot units + PR approval (with evidence)──► ready
                                                                                    │
                                                         found wrong ──► suspended ◄┘
```

| Maturity | What Kintsugi allows |
|---|---|
| `template` | Nothing that depends on it runs |
| `draft` | Runs on pilot units only; every run recorded |
| `ready` | Runs on any unit in scope |
| `suspended` | Blocked immediately; running work is flagged |

- **Readiness rule**: a stage runs for a unit only if **every layer providing each required capability** allows it.
- **Waivers**: a waiver lets a stage run anyway, for a limited scope and until an expiry date. It is approved by the rulebook owners in a PR and recorded on every run that uses it. Waivers can never lift `suspended`.
- **Gate G3**: requires the project's pipeline capabilities to be `ready`.

## Extension points (no Kintsugi change needed)

| Need | Where |
|---|---|
| Another stack pair | Add a pack; select it for the applications |
| A new kind of rule or check | Add a custom capability; reference it from a pipeline stage |
| A different delivery process | Edit or add `pipelines/*.yaml` (custom phases map to a built-in category) |
| Toolchains for running or comparing | Runners with their own container image (from the installation allowlist) |
| Stack-specific skills, reviewer agents, commands or hooks for members | An agent plugin in `packs/<pack>/plugins/` (Claude Code plugin format) |
| A member harness without plugin support | A declarative fallback renderer in `harnesses/` (or installation-level) |
| Something Kintsugi does not model yet | `x-*` fields are preserved; the schema evolves via `kintsugi rulebook migrate` |

Extensions that widen the trust boundary are controlled at installation level, approved by owners and audited:
- runner images;
- harness transformer plugins.

Runtime agents are not configured in the rulebook: agents are installation data managed in the Agent Builder, and the launcher supplies the definition with each job ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md), [ADR-0026](../../decisions/0026-runtime-agents-and-agent-builder.md)). Projects shape agent behavior only through the rulebook content a job reads, plus the model binding per agent id.

## How the rulebook is consumed

The runtime agents in this table are planned; when introduced, they receive rulebook content through the job's read-only paths and task.

| Consumer | Uses |
|---|---|
| Pipeline engine | Pipelines, capability `requires`, maturity, waivers |
| `knowledge-ingest` | Source notes, unit kinds |
| `assessment`, `wave-planner` | Unit kinds; they propose unit files and `dependsOn` for people to confirm |
| `to-be-analyst` | Target conventions, target-base checklist |
| `task-planner` | Rules whose `appliesTo` matches the unit (mappings, UI patterns, review rules), conventions, task-pack templates, skills |
| `gate-reviewer` | Review rules and conventions that apply to the unit; findings cite rule IDs |
| Runner / compare stages | Runners, canonicalizers, comparators |
| Member harnesses | Pack plugins (skills, agents, commands, hooks), installed from the generated project marketplace or rendered by fallback renderers |
| Governance | Maturity, waivers, evidence, rulebook version + commit in provenance, stale units after rule changes |

## The build track in the pipeline

| Build step | Pipeline phase | Result |
|---|---|---|
| **Bootstrap** | P0 | Workspace repo created from the starter template, joined, or copied from another rulebook. Repos registered, packs and pipelines selected per application |
| **Shape** | P1–P2 | Packs adapted (`draft`): stacks, unit kinds, source notes, conventions, mappings, UI patterns, review rules, runners; unit files proposed by `assessment` and confirmed |
| **Verify** | P3 | Capabilities exercised on pilot units and promoted to `ready` with evidence; gate G3 |
| **Evolve** | P4–P7 | Lessons learned flow back via PRs. Rule changes mark affected units `stale`; vendored packs are upgraded through reviewed PRs |

## Rules that come with it

- **Design-first.** Conventions, UI patterns and project-level UX decisions are decided once, in the rulebook, before units are converted. Units cite the rule or ADR they follow.
- **One source of truth.** If a rule is not in the resolved rulebook for a unit, it is not a rule for that unit.
- **Every accepted difference leaves a trace.** Tolerances, canonicalizer changes and waivers are committed with a cited rule or ADR and approved by a human.
