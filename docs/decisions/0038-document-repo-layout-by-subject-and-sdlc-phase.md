# ADR-0038: Document repo layout by subject and SDLC phase

- Status: Accepted. The unit and application trees below are superseded by ADR-0042 and ADR-0051. Coding Agent Workflow task context and evidence-bound continuation amend the member access and gate-record rules (ADRs 0062 and 0063).
- Date: 2026-10-15
- Decision register: D55

Reference ID policy amended by [ADR-0075](0075-compact-stable-document-reference-ids.md). Historical formats below remain readable.

## Context

Each project has one document repo for everything except code. Its current layout grew around stages and tools rather than the subjects that live through the migration. Application inputs, assessment outputs, human documents, scripts and aggregates are mixed under `assessment/<app>/`; the same unit is spread across the catalog, per-item assessment files, the AS-IS knowledge tree and the unit-state tree. Other artifacts use inconsistent application dimensions or do not say whether a unit identifier is a full id or only its final segment.

The current reference also has no durable homes for the P0 program charter and policies, the P1 portfolio, P2 TO-BE requirements and design or a uniform gate record. Unit frontmatter is the only current gate-state record. Generated aggregates and authored inputs share confusing folder names, and the current sequential rule-number scheme can renumber rules when the extracted set changes. Progress must remain derived from Git artifacts; it must not become a second state machine in Postgres.

The delivery method follows phases P0–P4 and gates G0–G4. A project therefore needs stable subject paths and reviewable evidence from an AS-IS rule through a TO-BE requirement and test result, while keeping runtime output, human review and implementation responsibilities distinct.

## Decision

Keep one Git document repo per project, but organize it by subject and lifecycle rather than by stage or tool. Project-wide material stays at the root; every application's material lives under `applications/<app>/`; a unit lives in one directory for its full P1–P4 life:

```text
kintsugi.yaml
program/                                  # P0: charter.md, raci.md, ai-strategy.md, kpi-baseline.md, ai-usage-policy.md
standards/                                # P2–P3: conventions/, mappings/, review-rules.md
plugins/                                  # P3: project-authored plugins only
architecture/                             # P2: blueprint.md, coexistence.md, data-migration.md, poc-plan.md, adr/
portfolio/                                # P1: scorecard, 7R decision, wave plan across applications
gates/G0.md ... G3.md                    # project-level gate records
applications/<app>/
  inputs/                                  # INTENT.md, graph/, telemetry/ attached by people
  assessment/                              # P1, assess outputs and tools
  to-be/                                   # P2: requirements.md, design.md
  gates/G1.md G2.md            # application-level gate records
  units/<module>/<unit>/                   # P1–P4, one directory per unit
    unit.md                                # state and gate references
    as-is.md                               # P1
    rules.json                             # P1 machine extraction
    rules-review.json                      # P1 human verdicts
    findings.json topology.json trace.json meta.json
    task.md design.md                      # P4
    reviews/G4.md                           # G4 record
  generated/                               # rebuilt application aggregates
```

The unit id is always the full `<app>/<module>/<unit>`; `<unit>` in a path is the last segment. The catalog entry remains `<module>/<unit>` because it is scoped by its containing application. **Unit** is the domain word; **item** means only a catalog entry. Existing API/domain `WorkItem` names remain unchanged for compatibility.

The layout module in `packages/domain` is the sole owner of document-repo path construction. It provides pure functions such as `assessmentDir(app)`, `unitDir(app, module, unit)`, `unitStatePath(app, module, unit)` and `generatedDir(app)`, plus the `{app}` token forms needed by stage plans. Consumers call these functions instead of embedding layout paths. Phase B first routes the current paths through this module without changing their values; Phase C changes the module and migrates consumers.

### Traceability and review

- `rules.json` is machine output and the extraction source of truth. Human rule verdicts (`confirmed`, `refuted`, `clarify`, approver and date) live separately in `rules-review.json`; a verdict whose rule id is absent from the current extraction is reported as orphaned, not silently applied.
- Rule ids are deterministic and citation-derived, not sequential per-item numbers. A rerun with the same canonical unit and citation retains the id; changed or missing citations produce a new id, and the prior verdict is orphaned.
- TO-BE requirement entries use `REQ-` ids and carry `derivedFrom: [RULE-...]`.
- `trace.json` includes `requirements`, `pullRequests` and `tests`, connecting source rules to requirements, implementation and evidence.
- Every gate record uses `decision`, `approvers`, `evidence` (repository paths) and `date`. Project gates live in `gates/`; application gates live in `applications/<app>/gates/`; a unit's `unit.md` frontmatter points to its G4 record under `reviews/`. Gate records arrive through pull requests and are never auto-committed. A phase is complete when its output artifacts exist and its gate record has merged. The API derives phase and unit progress from these Git files; it does not store progress separately.

### Commit policy

Keep auto-commit limited to unit state (`applications/*/units/**/unit.md`), generated aggregate directories, and the still-applicable paths already auto-committed under ADR-0019. `understand` continues to use `reviewAll`, so per-unit extraction, specifications and other authored outputs arrive in its pull request. Do not broaden auto-commit to all files under a unit directory. Gate records are always reviewed through pull requests.

### Existing-repository migration

This is a breaking path change; do not add compatibility symlinks, duplicate writes or fallback reads. Migrate an existing document repo in one reviewed PR:

1. Build a mapping from each catalog item to its full `<app>/<module>/<unit>` id. Resolve legacy task and review paths using application ownership before moving anything; do not infer the app from a short module slug.
2. Use `git mv` to move application inputs into `applications/<app>/inputs/`, assessment outputs into `applications/<app>/assessment/`, each AS-IS specification to the corresponding unit's `as-is.md`, and unit state to `unit.md` in that unit directory. Move task packs, detail designs, review records and verification evidence into their unit directories.
3. Move project-wide P0, P1 portfolio, P2 architecture/standards and gate records to their new project-level homes.
4. Do not move stale generated aggregates as authored source. Rebuild them from the migrated unit files after merge, then verify their auto-commit paths.
5. Update `kintsugi.yaml` auto-commit paths and every reader/writer in the same migration rollout. Remove the old paths; no compatibility copy remains.

## Consequences

- Paths change for document-repo readers, writers, member plugins, API result builders and portal links. The path module lets the migration change those consumers centrally and makes the current-path checkpoint testable.
- Existing document repos require an explicit `git mv` migration. The migration PR must validate full unit ids and app ownership before moving short-id artifacts.
- Human rule verdicts survive extraction reruns because they are separate from machine output; citations that no longer exist surface as orphaned review records.
- Gate decisions become auditable Git evidence and do not create an auto-commit bypass. The API continues to derive progress from files; no progress columns or new datastore are introduced.
- The layout change does not rename API routes, permission codes, database columns or the `assess`/`understand` stage ids.
- Phase C must verify that `matchesPathGlob` still lets `**` span directories while `*` stays within one path segment, and must test that only unit state and generated outputs take the direct-commit path.

## Alternatives considered

- **Keep the current layout and only document it.** Rejected: a unit would still span multiple trees, stage-owned folders would still mix inputs and generated outputs, and the missing P0 and gate homes would remain unresolved.
- **Group everything by stage.** Rejected: a unit's rules, specification, task, review and test evidence would still be scattered across stage trees.
- **Group by writer (human, runtime, member harness).** Rejected: writers can change, while a unit and its evidence must remain together; generated and authored content would still share subject folders.
