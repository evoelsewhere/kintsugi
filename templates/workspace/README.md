# Workspace repo starter template

Kintsugi scaffolds a new project's workspace repo from this template (**Create** in the portal). The scaffold contains:
- `kintsugi.yaml`: the project manifest; it pins the rulebook;
- `rulebook/`: a neutral starter rulebook in which every capability is at maturity `template`.

Nothing here is stack-specific. A project must **build** its rulebook before the pipeline can run: adapt it, verify it on pilot units, then promote capabilities to `ready`. Follow the [build a project](../../docs/guides/build-project.md) guide.

The other folders of the workspace repo (`inventory/`, `assessment/`, `knowledge/`, `tasks/`, …) are created as the project progresses. See the [workspace repository reference](../../docs/reference/workspace-repo.md).
