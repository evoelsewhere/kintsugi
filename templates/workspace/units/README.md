# Units

One file per work item: `units/<application>/<module>/<unit>.md`.
- The YAML frontmatter is the unit's state; the body is a short summary.
- Format: see `docs/reference/workspace-repo.md#unit-files` in the Kintsugi repo.

State changes go through Kintsugi (portal, CLI, MCP), which commits them as `kintsugi-bot`. Edit unit files directly only through a PR. Kintsugi validates direct edits on sync.

`_example.example.md` shows the format; it is not loaded.
