# Build a project

> **Partly available.** The portal manages projects, applications and their repositories, renders `kintsugi.yaml` and publishes it (**Administration → Projects → Publish kintsugi.yaml**). The same pull request carries the starter structure from `templates/document-repo/` for everything the document repo does not have yet; joining an existing repo by reading its `kintsugi.yaml` is planned.

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
- Git servers and every repository the project uses (document, legacy, legacy-data, target) are registered in **Settings → Git**. Kintsugi clones them into its own storage ([ADR-0025](../decisions/0025-git-core-and-checkout-storage.md)).

## Step 1 — Document repo (P0)

Prepare the document repo, then register it in Settings → Git:
- **New**: create an empty repository. **Publish kintsugi.yaml** fills in the [starter structure](../../templates/document-repo/) through one pull request.
- **Existing**: use the project's existing document repo.

Then **Administration → Projects → New project**: name, id and the document repo. A project has exactly one document repo, and a document repo belongs to one project only. In `kintsugi.yaml` it is declared once, under `document:`.

**Publish kintsugi.yaml** proposes the rendered manifest together with the starter structure: the numbered project-level folders (`00-project/` with the glossary and `portfolio/`, `01-standards/`, `02-architecture/`, `03-transition/`) and `plugins/` with their READMEs, and one skeleton per application under `10-applications/<app>/` (`00-inputs/`, `01-legacy/`, `02-modern/`, `_generated/`) (made from the template's `billing-web` folder, with the application's id). Files the repo already has are never replaced, so publishing again after adding an application only brings that application's skeleton; untick "Also create the starter structure" in the dialog to publish the manifest alone. Format samples (`*.example`) stay in the template. Planned: joining an existing repo by reading its `kintsugi.yaml`.

## Step 2 — Register the repos (P0)

On the project page, **Add application** for each application in scope, then **Link** its repositories. The page groups them as they appear in `kintsugi.yaml`; for each application set:
- `repos`, grouped by role:
  - **AS-IS**: `legacy` (code) and `legacy-data` (schemas, dumps, reference data), any number, read-only;
  - **TO-BE**: `target`, any number, each with `component:` naming the architecture component it implements. Only members write to them;
- `pipeline` (optional): the id of a pipeline you declare under `pipelines:` in the same file (stages, performers, gates; custom phases need a `category`).

The project page shows the rendered `kintsugi.yaml`. Add the project's `unitKinds` and any `pipelines` (the portal renders defaults for these), then commit it to the document repo through a PR. **Gate G0**: the document repo, the repos and the pipelines are declared.

## Step 3 — Write the standards (P1–P3)

The project's knowledge about the target is plain Markdown under `01-standards/`, with no schema and no maturity:

| Path | What to write | Helped by |
|---|---|---|
| `01-standards/conventions/` | Target conventions extracted from the scaffolded target repos: layering, naming, idioms, UI kit, build and CI. UX decisions go to `02-architecture/adr/` | `to-be-analyst` |
| `01-standards/mappings/` | One file per legacy construct or UI pattern → target equivalent, with an example | Pilot reverse designs |
| `01-standards/templates/` | The project's design sets: the format and required content of each unit's basic design, detail design, API specification, test cases, … as templates with checks. See [Define a project's design templates](define-design-templates.md) | The customer's design format, the foundation team |
| `01-standards/review-rules.md` | The rules reviewers enforce, each with a stable id (`RR-001`, …) and `block` / `warn` | Architecture rules, lint config |
| `plugins/<project>-<topic>/` | Member plugins: skills, reviewer agents, commands, hooks. Validate with `claude plugin validate --strict` | The built-in `kintsugi` plugin as a base |

Notes:
- **Design**: the common design (the architecture and `02-architecture/common/`) is written by hand by the foundation team, one document per component, and merged through a pull request (no command writes it); each unit's basic and detail design is generated from the Design page of the portal and reviewed in its pull request ([ADR-0049](../decisions/0049-design-sets-generated-by-the-runtime.md)).
- **Samples**: the template's `.example` files show the shape. Copy the ones you adopt to a real name and delete the rest.
- **Pilot units**: flag 1–2 representative units per kind as `pilot: true` and run them first. Fix the standards where results were inconsistent, unclear or wrong.
- **Gate G3** (Prepare Factory) is a human decision: the target repos are scaffolded, the standards are written and the pilots are reviewed.

## Step 4 — Evolve (P4 onwards)

- **Changes**: every change to `01-standards/` or `plugins/` goes through a PR to the document repo. Runtime jobs and task packs record the document repo commit they used.
- **A standard turns out to be wrong**: fix it in a PR and re-review the units that relied on it.
- **At project end**: consider sharing standards or plugins with other projects. This is a deliberate copy, not an automatic sync.

Reference: [document repository](../reference/document-repo.md).
