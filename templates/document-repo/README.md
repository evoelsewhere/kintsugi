# Document repo starter template

Kintsugi scaffolds a new project's document repo from this template (**Create** in the portal). Each project has exactly one document repo: it holds everything except code. The scaffold contains:
- `kintsugi.yaml`: the project manifest: the document repo, the applications with their AS-IS (`legacy`, `legacy-data`) and TO-BE (`target`) repos, and their pipelines;
- `standards/`: the project's target conventions, legacy-to-target mappings and review rules, as plain documents;
- `plugins/`: member plugins in the Claude Code plugin format;
- `units/`: work item files.

Nothing here is stack-specific. Before the migration starts, register the repos and write the standards: follow the [build a project](../../docs/guides/build-project.md) guide.

The other folders of the document repo (`assessment/`, `knowledge/`, `tasks/`, `reviews/`, …) are created as the project progresses. See the [document repo reference](../../docs/reference/document-repo.md).
