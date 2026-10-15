# Units

One file per unit: `units/<app>/<module>/<unit>.md`. The unit id is the full `<app>/<module>/<unit>`; `<unit>` alone is its final path segment.
- The YAML frontmatter is the unit's state; the body is a short summary.
- Format: see `docs/reference/document-repo-unit-files.md` in the Kintsugi repo.

State changes go through Kintsugi (portal, CLI, MCP), which commits them as `kintsugi-bot`. Edit unit files directly only through a PR. Kintsugi validates direct edits on sync.

`_example.example.md` shows the format; it is not loaded.
