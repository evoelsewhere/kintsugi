# Rulebook

The project-specific rules Kintsugi and the team follow on this project. Structure: see `docs/reference/rulebook.md` in the Kintsugi repo.

| Path | Content |
|---|---|
| `rulebook.yaml` | Root manifest: version, owners, `extends`, packs, custom capabilities, pipelines, harnesses |
| `packs/<pack>/` | One pack per stack pair or concern: `pack.yaml` plus conventions, mappings, UI patterns, review rules, canonicalizers, runners, target-base checklist, skills, task-pack templates |
| `pipelines/` | Pipeline definitions: phases, stages, performers, required capabilities, gates |
| `overrides/<app>/[<module>/]` | Application- and module-level overrides, using the same folders as a pack |
| `waivers/` | Time-boxed readiness exceptions |
| `harnesses/` | Extra member-harness renderers |
| `vendor/` | Vendored external rulebooks / packs. Do not edit; use `kintsugi rulebook upgrade` |

**Rules for changing the rulebook:**
- **Owners** (`owners` in `rulebook.yaml`) approve promotions, waivers and harness renderers.
- **Changes** go through PRs only. Bump `version` in `rulebook.yaml` on every change.
- **Samples**: files ending in `.example.*` are not loaded. Rename a sample, adapt it, and reference it from a capability's `uses` or the root manifest.

## Change log

| Version | Date | Change |
|---|---|---|
| 0.1.0 | | Scaffolded from the Kintsugi starter template |
