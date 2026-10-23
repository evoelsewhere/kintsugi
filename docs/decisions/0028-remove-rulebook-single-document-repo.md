# ADR-0028: Remove the rulebook; one document repo per project

- Status: Accepted. Amended by [ADR-0041](0059-coding-agent-workflow-through-cli-and-local-mcp.md) for the separate hookless Coding Agent Workflow plugin and by [ADR-0043](0061-evidence-bound-pr-continuation.md) for evidence-bound gate continuation.
- Date: 2026-10-10
- Decision register: D48 (supersedes D34–D38 and D41; amends D19, D29, D43)
- Supersedes: [ADR-0011](0011-project-rulebook.md), [ADR-0013](0013-composable-open-rulebook.md)
- Amends: [ADR-0004](0004-runner-container-per-job.md) (no rulebook runners), [ADR-0012](0012-work-items-as-files-in-git.md) (unit frontmatter), [ADR-0015](0015-member-assets-as-agent-plugins.md) (where project plugins live), [ADR-0019](0019-workspace-repo-write-path.md) (the workspace repo is now the document repo), [ADR-0020](0020-docker-api-via-socket-proxy.md) (no runner image allowlist), [ADR-0027](0027-builtin-modernization-content.md) (commands read `standards/`)

## Context

Historically, each project built a *rulebook* in its workspace repo before the pipeline could run: packs per stack pair, capabilities with a maturity (`template` → `draft` → `ready` / `suspended`), waivers, runners, vendored and override layers, `derivedFrom`, and a capability-based gate G3 (Prepare Factory).

In practice this machinery cost more than it returned:

- Projects need the *content* (target conventions, legacy-to-target mappings, review rules, member plugins), not a schema, a layering model and a maturity lifecycle around it.
- Readiness checks, waivers and stale-unit detection added engine code, domain types and portal screens that no project had used.
- Rulebook runners required an extra container type, an image allowlist and a separate security story.
- "Workspace repo" was an unclear name for the one repo that holds a project's documents.
- The repository model (`workspace` / `source` / `target`) could not express legacy data repos or several target repos per application.

## Decision

1. **No rulebook.** Packs, capability maturity, readiness checks, the capability-based gate G3, waivers, `runners/`, the `vendor/` and `overrides/` layers, `derivedFrom`, `rulesApplied` / `stale` tracking and the `Kintsugi-Rulebook` commit trailer are removed from the engine, the domain, the API, the portal, the templates and the documentation.
2. **One document repo per project.** The concept "workspace repo" is renamed **document repo**. It holds everything except code: `kintsugi.yaml`, `assessment/`, `knowledge/as-is/` and `knowledge/to-be/`, `architecture/adr/`, `units/`, `tasks/`, `reviews/`, `deliverables/`, `golden/`, `runs/`, `standards/` and `plugins/`.
3. **Project knowledge is plain documents**, without schema or maturity:
   - `standards/conventions/`: target conventions;
   - `standards/mappings/`: legacy construct or UI pattern → target;
   - `standards/review-rules.md`: the rules reviewers enforce;
   - `plugins/`: member plugins in the Claude Code plugin format (ADR-0015). Marketplace files are still generated.
   A standard applies once it is merged; changing one is a pull request to the document repo.
4. **Pipelines** are declared directly in `kintsugi.yaml` (`pipelines:`), or an application chooses a built-in pipeline by id. There is no `rulebook/pipelines/`.
5. **Repository model** in `kintsugi.yaml`:
   - the `document` repo is declared once, at project level;
   - per application, the **AS-IS** group: repos with role `legacy` (code, any number) and `legacy-data` (data, any number), read-only for Kintsugi;
   - per application, the **TO-BE** group: repos with role `target` (any number), each with `component: <name from the architecture>`. Only members write to them; the runtime never writes.
   The document repo holds both AS-IS analysis and TO-BE documents; the portal may show it under TO-BE.
6. **Provenance** records the document repo commit an artifact was produced against (`documentRepoCommit`) instead of a rulebook `id@version`.

## Consequences

- The domain loses the rulebook, pack, capability, waiver and runner types and `checkReadiness`; repository roles become `legacy | legacy-data | document | target` with an optional `component`.
- The API loses the rulebook-entries module. No permission code was specific to the rulebook; migration `007_drop_rulebook.sql` only rewrites the `governance.manage` description.
- Gate G3 no longer has an automatic, capability-based check. What replaces it is open (see below).
- Rulebook runners and `KINTSUGI_JOB_IMAGE_ALLOWLIST` are gone; equivalence testing that needs a project toolchain runs on members' machines or in the project's own CI.
- The starter template moves from `templates/workspace/` to `templates/document-repo/`.
- Open follow-ups: what G3 (Prepare Factory) requires now, for example a human checklist (target repos scaffolded, `standards/` written, pilot units done); and the list of built-in pipelines (at least one per 7R strategy in use, starting with `refactor`).

## Alternatives considered

- **Keep the rulebook but make maturity optional.** Rejected: it keeps the types, the layering and the screens, and the optional part becomes the default anyway.
- **Keep the name "workspace repo".** Rejected: "workspace" collides with job workspaces and pnpm workspaces, and does not say what the repo holds.
