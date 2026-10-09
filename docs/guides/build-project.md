# Build a project (shape the rulebook)

> **Planned behavior.** The portal flow described here is part of milestones M0–M3. Until then, follow the same steps directly in the workspace repo.

Kintsugi is a common engine. Before a project can run its pipeline, the team **builds** it:
1. create the workspace repo;
2. register the repositories;
3. turn the starter rulebook into project-specific, verified rules.

Background: [project rulebook](../architecture/concepts/project-rulebook.md). Exact formats: [rulebook reference](../reference/rulebook.md).

**Who:**
- **Owner**: architect + AI champion. They are listed as the rulebook `owners`.
- **Contributors**: BA, KM engineer, senior developers.

## Prerequisites

- The **source repos** (legacy) are reachable by Kintsugi. They are always read-only for the runtime.
- The **target repo** has a scaffolded base prepared by the solution architect: framework, layering, conventions, build and CI.
- Git servers are registered (Admin → Connectors).
- For runners, the installation admin has allowlisted the needed container images.

## Step 1 — Bootstrap (P0)

1. Portal → **New project**, then pick one of:
   - **Create**: scaffold a new workspace repo from the [starter template](../../templates/workspace/). It contains one `main` pack and a `refactor` pipeline, with every capability at `template`.
   - **Join**: point Kintsugi to an existing workspace repo; it reads `kintsugi.yaml`.
   - **Copy from**: start from another project's rulebook. To keep a pinned link instead of copying, add it under `extends`; `kintsugi rulebook upgrade` then vendors it.
2. Create **one pack per stack pair** (`packs/<id>/pack.yaml`), plus concern packs if useful (e.g. `org-baseline`).
3. In `kintsugi.yaml`, for each application set:
   - `repos` with their roles: `source` / `target`;
   - `packs`, plus `defaults.packs` for packs every application uses;
   - `pipeline`.
4. Copy or adapt pipeline definitions in `rulebook/pipelines/`. Add or remove stages, set performers and gates, and add custom phases (with a `category`) or custom capabilities as needed.
5. Commit through a PR. **Gate G0**: workspace repo, repos, packs and pipelines are declared.

## Step 2 — Shape (P1–P2)

For each pack, adapt the capabilities from `template` to `draft`:

| Capability | What to do | Helped by |
|---|---|---|
| `understand` | `stacks`, `units.kinds`, `conventions/source-notes.md`; review and confirm the unit files `assessment` proposes in `units/**` | `knowledge-ingest`, `assessment`, `kb.ask` |
| `conventions` | `conventions/target.md` from the target base, `conventions/ui.md`, `target-base/checklist.md`, UX decisions as ADRs | `to-be-analyst` |
| `mapping` | One file per mapping / UI pattern, with frontmatter `id`, `title`, `appliesTo` | Pilot reverse designs |
| `convert` | Agent plugins in `plugins/<project>-<topic>/` (skills, reviewer agents, commands, hooks; validate with `claude plugin validate --strict`), task-pack templates per unit kind | The built-in `kintsugi` plugin as a base |
| `review` | One file per review rule with `id`, `severity`, `check`, `appliesTo` | Architecture rules, lint config |
| `compare` | Canonicalizer profiles; runners with an allowlisted `image`; custom comparators if needed | Golden cases from the legacy system |
| custom (e.g. `data-migration`) | Whatever the capability needs; declare it in `rulebook.yaml` → `capabilities` | — |

Notes:
- **Scoped maturity**: if readiness differs by unit kind or application, use `{default, byKind, byApplication}`.
- **Overrides**: put application- or module-specific exceptions in `overrides/<app>/[<module>/]` instead of forking a pack.
- **Samples**: rename the `.example` files you adopt and reference them from `uses`; remove the ones you do not need.

## Step 3 — Verify (P3)

1. Flag 1–2 representative units per unit kind as `pilot: true` in their unit files.
2. Run the pipeline on the pilot units with `draft` capabilities.
3. Use the **resolved view** of each pilot unit to check which rules applied, and from which layer.
4. Fix the rulebook where results were inconsistent, unclear or wrong.
5. Promote each verified capability to `ready` in a PR approved by the `owners`:
   - list the pilot units and reviews as `evidence`;
   - bump `version`.
6. **Gate G3**: every capability required by the applications' pipelines is `ready` for the unit kinds in scope.

If a capability cannot be verified in time but work must start, add a **waiver** (`waivers/W-###.yaml`) with a narrow scope, a reason and an expiry, approved by the owners.

## Step 4 — Evolve (P4 onwards)

- **Changes**: treat the rulebook like code. Every change goes through a PR and bumps `version`.
- **Impact**: when a rule changes, the units that applied it are marked `stale` and appear in the re-review queue.
- **A rule turns out to be wrong**: set its capability to `suspended`. That stops dependent stages immediately. Fix the rule, verify again, and promote.
- **Vendored content**: upgrade with `kintsugi rulebook upgrade <id> --to <version>`. Review the diff PR; changed capabilities fall back to `draft`.
- **At project end**: consider contributing packs back to the organization library. This is a deliberate copy, not an automatic sync.

Reference: [rulebook](../reference/rulebook.md) · [workspace repository](../reference/workspace-repo.md).
