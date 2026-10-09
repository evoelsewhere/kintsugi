# Rulebook

> **Status**: schema draft (`schemaVersion: 1`).
> **Concept**: [project rulebook](../architecture/concepts/project-rulebook.md).
> **Decisions**: [ADR-0011](../decisions/0011-project-rulebook.md) (project-built rules), [ADR-0013](../decisions/0013-composable-open-rulebook.md) (composable, open structure), [ADR-0014](../decisions/0014-no-code-graph-no-agent-config.md) (no parsing, no discovery or agent configuration).

The rulebook lives in the workspace repo, at `rulebook/` by default (`kintsugi.yaml` → `rulebook.path`).
- **Path containment**: every path a manifest declares must stay inside the rulebook directory.
- **Samples**: files ending in `.example.*` are never loaded.
- **Extension fields**: unknown keys prefixed `x-` are allowed on any object, preserved, and ignored by Kintsugi.

## 1. Layout

```
rulebook/
  rulebook.yaml                 # root manifest (§2)
  README.md                     # scope, owners, change log
  packs/<pack>/                 # one pack per stack pair or concern (§3)
    pack.yaml
    conventions/  mappings/  ui-patterns/  review-rules/
    canonicalizers/  runners/  target-base/
    plugins/<plugin>/           # agent plugins for member harnesses (Claude Code plugin format, ADR-0015)
    task-packs/
  pipelines/<id>.yaml           # pipeline definitions (§5)
  overrides/<app>/[<module>/]   # application / module overrides, same folders as a pack (§4)
  waivers/W-###.yaml            # time-boxed readiness exceptions (§6.3)
  harnesses/<id>.yaml           # extra member-harness renderers (§8)
  vendor/<id>@<version>/        # vendored external rulebooks / packs (§4.2)
```

## 2. `rulebook.yaml`

```yaml
schemaVersion: 1
id: billing-modernization
version: 0.4.0                       # the only place the version is declared
owners: [architect, ai-champion]     # roles that approve promotions, waivers, harness renderers

extends:                             # vendored snapshots (§4.2)
  - id: org-baseline
    version: 2.1.0
    source: git@example.com:org/rulebook-library.git
    path: vendor/org-baseline@2.1.0
    capabilities:                    # the project's own maturity for vendored content
      review: {maturity: ready, evidence: [reviews/billing-web/invoices/invoice-search/42.md]}

packs: [packs/webforms-to-aspnetcore, packs/cobol-batch-to-java]

capabilities:                        # registry of custom capabilities (well-known ones need no entry)
  data-migration: {description: Table and data migration rules, scripts and checks}

pipelines: [pipelines/refactor.yaml, pipelines/rehost.yaml]

harnesses: [harnesses/cursor.yaml]   # extra renderers (§8)
```

## 3. Packs — `packs/<pack>/pack.yaml`

```yaml
id: webforms-to-aspnetcore
description: .NET Framework 4.8 WebForms → ASP.NET Core 8 + React
stacks:
  source: [{name: dotnet-framework, version: "4.8", frameworks: [webforms, ado-net]}]
  target: [{name: dotnet, version: "8", frameworks: [aspnetcore, efcore, react]}]

units:
  kinds: [screen, api, batch-job, db-object]   # unit files themselves live in units/** (declared or agent-proposed)

capabilities:
  understand:  {maturity: ready, uses: [conventions/source-notes.md], evidence: [...]}
  conventions: {maturity: ready, uses: [conventions/, target-base/checklist.md]}
  mapping:
    maturity: {default: draft, byKind: {screen: ready}}
    uses: [mappings/, ui-patterns/]
  convert:     {maturity: draft, uses: [plugins/billing-webforms, task-packs/]}
  review:      {maturity: draft, uses: [review-rules/]}
  compare:     {maturity: template, uses: [canonicalizers/, runners/]}
  data-migration: {maturity: template, uses: [mappings/data/]}

runners:
  run-target:
    image: mcr.microsoft.com/dotnet/sdk:8.0        # must match the installation image allowlist
    command: [bash, runners/run_target.sh]
    resources: {cpus: 2, memory: 4g, timeoutSec: 1800}
    network: none                                  # none | allowlist (admin-approved hosts)
  compare-pdf:
    image: registry.internal/tools/pdfdiff:1.4
    command: [pdfdiff, --report, /out/report.json]

compare:
  defaultProfile: canonicalizers/http-json.yaml
  comparators: {pdf: compare-pdf}                  # custom comparators = runners emitting the report contract
```

## 4. Composition

### 4.1 Precedence and merge

Lowest to highest:
1. vendored (`extends`, in listed order);
2. local packs (in listed order);
3. `overrides/<app>/`;
4. `overrides/<app>/<module>/`.

The packs that apply to a unit are `defaults.packs` + `applications[].packs` from `kintsugi.yaml`.

| Content | Merge rule |
|---|---|
| Rules with an `id` (mappings, UI patterns, review rules) | Same `id` in a higher layer replaces the lower one; otherwise additive |
| Other files (conventions, checklists, skills, task-pack templates) | Same relative path in a higher layer replaces the lower one; otherwise additive |
| Capability maturity | Declared by the layer that provides the capability. A unit needs every providing layer to satisfy the requirement (§6.2) |

Kintsugi exposes the **resolved view** per unit: each rule shown with the layer it came from.

### 4.2 Vendoring and upgrade

- `extends` entries are snapshots copied into `vendor/<id>@<version>/` and committed. Nothing is fetched at run time.
- `kintsugi rulebook upgrade <id> --to <version>`:
  1. fetches the new version from `source` and vendors it next to the old one;
  2. opens a PR that shows the diff and resets to `draft` every capability whose files changed;
  3. marks as `stale` the units that applied changed rules.
- Maturity in vendored content is ignored. The project declares its own maturity under `extends[].capabilities` (default `draft`).

## 5. Pipelines — `pipelines/<id>.yaml`

```yaml
id: refactor
appliesTo: {dispositions: [refactor, replatform]}
phases:
  - id: discover-assess
    stages:
      - {id: ingest, performer: {agent: knowledge-ingest}, requires: [understand]}
      - {id: assess, performer: {agent: assessment},       requires: [understand], gate: G1}
  - id: migrate
    perUnit: true
    stages:
      - {id: plan,      performer: {agent: task-planner},       requires: [conventions, mapping, convert]}
      - {id: implement, performer: {member: [dev]},             requires: [convert]}
      - {id: review,    performer: {agent: gate-reviewer},      requires: [review]}
      - {id: approve,   performer: {member: [core-team]},       gate: G4}
  - id: security-hardening              # custom phase
    category: verify                     # built-in phase category used for reporting
    perUnit: true
    stages:
      - {id: scan, performer: {runner: sast}, requires: [security]}
  - id: verify
    perUnit: true
    stages:
      - {id: compare, performer: {runner: run-target, then: compare}, requires: [compare]}
gates:
  G3: {require: [rulebook-ready]}
  G4: {require: [build, static-check, gate-reviewer, human-approval]}
```

| Field | Meaning |
|---|---|
| `performer.agent` | One of the built-in runtime agents ([catalog](runtime-agents.md#catalog)); agents are fixed in code |
| `phases[].id` | A built-in phase id (`mobilize` … `hypercare-operate`), or a custom id with `category` |
| `perUnit` | Stages run per work item; otherwise once per application / project |
| `performer` | `{agent}` (built-in runtime agent), `{member: [roles]}`, or `{runner}` (optionally `then: compare`) |
| `requires` | Capability names (well-known or custom) checked before the stage runs |
| `gate` | Gate this stage closes |

Kintsugi ships built-in pipeline definitions (one per 7R) as templates; projects copy them into `pipelines/` and adapt them.

## 6. Capabilities and readiness

### 6.1 Capabilities

| Well-known | Typically needed by |
|---|---|
| `understand` | `knowledge-ingest`, `assessment` |
| `conventions` | `to-be-analyst`, `task-planner`, `gate-reviewer` |
| `mapping` | `task-planner`, members (via task packs) |
| `convert` | Members' harnesses |
| `review` | `gate-reviewer`, human reviewers |
| `compare` | Compare stages (runners + comparators) |
| `cutover` | Cutover checklists |

Custom capabilities are declared in `rulebook.yaml` → `capabilities` and provided by packs like any other.

### 6.2 Maturity

| Value | Meaning | Allowed use |
|---|---|---|
| `template` | Starter content, not adapted | Blocked |
| `draft` | Adapted, not verified | Pilot units only (`pilot: true`); every run recorded |
| `ready` | Verified on pilot units, approved by `owners` via PR, with `evidence` | All units in scope |
| `suspended` | Was usable, found wrong | Blocked immediately; running work is flagged |

- **Scoping**: maturity can be a single value or `{default, byKind, byApplication}`.
- **Resolution for a unit**: the most specific of `byApplication` → `byKind` → `default`.
- **Multiple providers**: a stage may run for a unit only if every layer that provides each required capability for that unit allows it.

### 6.3 Waivers — `waivers/W-###.yaml`

```yaml
id: W-003
capability: compare
packs: [webforms-to-aspnetcore]
scope: {kinds: [screen], units: []}     # empty = all units of these kinds
reason: Golden cases not yet captured; UAT covers equivalence for wave 1
approvedBy: [architect]
expires: 2026-11-30
```

Waivers come in through PRs approved by `owners`, and Kintsugi enforces their expiry. Every run that relied on a waiver records the waiver ID.

## 7. Structured rules

Mappings, UI patterns and review rules are **one rule per file**, with frontmatter:

```markdown
---
id: RR-002
title: UI uses only UI-kit components
appliesTo: {kinds: [screen], packs: [webforms-to-aspnetcore], globs: ["src/**/*.tsx"]}
severity: block          # review rules: block | warn
check: [lint, gate-reviewer]
relatesTo: [ADR-007]
---
Rationale, how to comply, examples.
```

- **Filtering**: `task-planner` puts into a task pack only the rules whose `appliesTo` matches the unit.
- **Citation**: `gate-reviewer` cites rule IDs in its findings.
- **Impact tracking**: units record the IDs they applied in `rulesApplied`.

## 8. Harness renderers — `harnesses/<id>.yaml`

```yaml
id: cursor
displayName: Cursor
render:
  skills:         {path: ".cursor/rules/{name}.mdc", format: markdown-frontmatter}
  projectContext: {path: AGENTS.md,                  format: markdown}
  roles:          {path: ".cursor/agents/{role}.md", format: markdown}
  mcp:            {path: .cursor/mcp.json,           format: json-mcp}
telemetry: [kintsugi-mcp, git]
```

- **Built-in renderers**: Kintsugi ships renderer configs for Claude Code, GitHub Copilot, Codex and ChatGPT.
- **Adding renderers**: installations can add renderers (Admin → Harnesses); projects can add them here, approved by `owners`.
- **Formats**: `format` names a transformer: `copy`, `agent-skill`, `markdown`, `markdown-frontmatter`, `json-mcp`, `toml-mcp`, … Admins can install transformer plugins.

## 9. Versioning, impact and schema evolution

- **Version**: declared only in `rulebook.yaml`. Every job, task pack, unit and commit records `rulebook: {version, commit}`.
- **Impact**: when a rule file changes, the units whose `rulesApplied` contains its ID get `stale: {since, rules}` and appear in the re-review queue.
- **Schema**: JSON Schema is generated from the [`packages/domain`](../../packages/domain/src/index.ts) types. `kintsugi rulebook migrate` upgrades `schemaVersion` through a PR.

A starter rulebook ships in [`templates/workspace/rulebook/`](../../templates/workspace/rulebook/).
