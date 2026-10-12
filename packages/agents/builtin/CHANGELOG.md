# Changelog

This changelog records the Kintsugi adaptation; it is not tied to a plugin manifest or a marketplace version.

## Unreleased — Kintsugi adaptation

- Adapt the upstream modernization method to Kintsugi runtime jobs, member harnesses, document-repository artifacts, and portal-owned progress presentation.
- Retain pure progress readers under `hooks/reader/`, mapping assessment, source, target, golden, and run data to Kintsugi repository namespaces for future portal use.
- Add the server-side JobOutput hook and its fail-closed credential scan, artifact-shape checks, redacted JSON report, bounds, and tests.
- Remove the Claude Code plugin manifest and pane/plugin-host code, including hook registration, terminal views, telemetry, and host-specific tests.
- `workflows/extract-rules.js` plans within the orchestrator's agent cap (`budget.agents`) instead of a fixed 1000, so its tail phases are never refused mid-run.
- Add the Kintsugi `understand` stage (`commands/modernize-understand.md`, no upstream counterpart) and its scripts `units_from_topology.py`, `merge_traceability.py` and `write_work_items.py`, with Python tests.
- The `assess` stage builds the item catalog (ADR-0033): `inventory.py` records a per-file sha256; new scripts `catalog_from_topology.py`, `apply_catalog_edits.py` and `reconcile_catalog.py` (shared helpers in `catalog_common.py`), with Python tests; the reader `parseItemCatalog` reads `assessment/<app>/catalog.json`.
- Add the shared `mermaid-diagrams` skill (`skills/mermaid-diagrams/`, adapted from softaworks/agent-toolkit at `3027f20f3181758385a1bb8c022d4041dfb4de84`, MIT, see `NOTICE`): Mermaid only, a diagram type per artifact, syntax-safety rules for untrusted names and size limits, with condensed references for flowchart, sequence, er, c4 and state diagrams. `legacy-analyst`, `business-rules-extractor` and `architecture-critic` load it; the `assess`, `map`, `understand`, `brief` and `reimagine` commands name it in `metadata.skills`; `reverse-design` asks for sequence and ER diagrams.
- Add `scripts/mermaid_lint.py`, a standard-library Mermaid lint (header, blocks, ids and keywords, quoted labels, classes, erDiagram cardinalities, C4 references, size limits; optional `mmdc` render), with Python tests. The JobOutput hook runs it over `.mmd` and Markdown outputs and reports what it finds as non-blocking `warnings`.
- Preserve upstream provenance: anthropics/claude-plugins-official `plugins/code-modernization` at `c8874f5ad883e26428f483ffa4d537cc81489e64`; see `NOTICE` and `LICENSE`.
