# Document repo starter template

This starter template is not currently scaffolded by the portal. `scripts/e2e/start.mjs` uses it to seed end-to-end environments; the portal's **Create** flow manages project, application and repository records but does not copy this template. Each project has exactly one document repo: it holds everything except code. The template contains:
- `kintsugi.yaml`: the project manifest: the document repo, the applications with their AS-IS (`legacy`, `legacy-data`) and TO-BE (`target`) repos, and their pipelines;
- `standards/`: the project's target conventions, legacy-to-target mappings and review rules, as plain documents;
- `plugins/`: member plugins in the Claude Code plugin format;
- `units/`: an example unit-state file.

Nothing here is stack-specific. Before the migration starts, register the repos and write the standards: follow the [build a project](../../docs/guides/build-project.md) guide.

Runtime jobs write their outputs under the paths described in the [current document repo layout](../../docs/reference/document-repo.md); the portal does not pre-create those directories from this template.
