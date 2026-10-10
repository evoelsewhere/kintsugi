# Build a project

> **Planned behavior.** The portal flow described here is part of milestones M0–M3. Until then, follow the same steps directly in the document repo.

Kintsugi is a common engine. Before the migration starts, the team sets the project up:
1. create or join the document repo;
2. register the AS-IS and TO-BE repositories;
3. write the project's standards and member plugins.

Exact formats: [document repository reference](../reference/document-repo.md).

**Who:**
- **Owner**: architect + AI champion.
- **Contributors**: BA, KM engineer, senior developers.

## Prerequisites

- The **legacy repos** (code and data) are reachable by Kintsugi. They are always read-only for Kintsugi.
- The **target repos** have a scaffolded base prepared by the solution architect: framework, layering, conventions, build and CI.
- Git servers are registered (Admin → Connectors).

## Step 1 — Document repo (P0)

Portal → **New project**, then pick one of:
- **Create**: scaffold a new document repo from the [starter template](../../templates/document-repo/).
- **Join**: point Kintsugi to an existing document repo; it reads `kintsugi.yaml`.

Declare the document repo once, under `document:` in `kintsugi.yaml`.

## Step 2 — Register the repos (P0)

In `kintsugi.yaml`, for each application set:
- `disposition` (7R);
- `repos`, grouped by role:
  - **AS-IS**: `legacy` (code) and `legacy-data` (schemas, dumps, reference data), any number, read-only;
  - **TO-BE**: `target`, any number, each with `component:` naming the architecture component it implements. Only members write to them;
- `pipeline`: a built-in pipeline id, or the id of a pipeline you declare under `pipelines:` in the same file (stages, performers, gates; custom phases need a `category`).

Also list the project's `unitKinds`. Commit through a PR. **Gate G0**: the document repo, the repos and the pipelines are declared.

## Step 3 — Write the standards (P1–P3)

The project's knowledge about the target is plain Markdown under `standards/`, with no schema and no maturity:

| Path | What to write | Helped by |
|---|---|---|
| `standards/conventions/` | Target conventions extracted from the scaffolded target repos: layering, naming, idioms, UI kit, build and CI. UX decisions go to `architecture/adr/` | `to-be-analyst` |
| `standards/mappings/` | One file per legacy construct or UI pattern → target equivalent, with an example | Pilot reverse designs |
| `standards/review-rules.md` | The rules reviewers enforce, each with a stable id (`RR-001`, …) and `block` / `warn` | Architecture rules, lint config |
| `plugins/<project>-<topic>/` | Member plugins: skills, reviewer agents, commands, hooks. Validate with `claude plugin validate --strict` | The built-in `kintsugi` plugin as a base |

Notes:
- **Samples**: the template's `.example` files show the shape. Copy the ones you adopt to a real name and delete the rest.
- **Pilot units**: flag 1–2 representative units per kind as `pilot: true` and run them first. Fix the standards where results were inconsistent, unclear or wrong.
- **Gate G3** (Prepare Factory) is a human decision: the target repos are scaffolded, the standards are written and the pilots are reviewed.

## Step 4 — Evolve (P4 onwards)

- **Changes**: every change to `standards/` or `plugins/` goes through a PR to the document repo. Runtime jobs and task packs record the document repo commit they used.
- **A standard turns out to be wrong**: fix it in a PR and re-review the units that relied on it.
- **At project end**: consider sharing standards or plugins with other projects. This is a deliberate copy, not an automatic sync.

Reference: [document repository](../reference/document-repo.md).
