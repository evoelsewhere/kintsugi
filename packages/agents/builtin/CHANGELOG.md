# Changelog

This changelog records the Kintsugi adaptation; it is not tied to a plugin manifest or a marketplace version.

## Unreleased — Kintsugi adaptation

- Adapt the upstream modernization method to Kintsugi runtime jobs, member harnesses, document-repository artifacts, and portal-owned progress presentation.
- Retain pure progress readers under `hooks/reader/`, mapping assessment, source, target, golden, and run data to Kintsugi repository namespaces for future portal use.
- Add the server-side JobOutput hook and its fail-closed credential scan, artifact-shape checks, redacted JSON report, bounds, and tests.
- Remove the Claude Code plugin manifest and pane/plugin-host code, including hook registration, terminal views, telemetry, and host-specific tests.
- `workflows/extract-rules.js` plans within the orchestrator's agent cap (`budget.agents`) instead of a fixed 1000, so its tail phases are never refused mid-run.
- Add the Kintsugi `understand` stage (`commands/modernize-understand.md`, no upstream counterpart) and its scripts `units_from_topology.py`, `merge_traceability.py` and `write_work_items.py`, with Python tests.
- Preserve upstream provenance: anthropics/claude-plugins-official `plugins/code-modernization` at `c8874f5ad883e26428f483ffa4d537cc81489e64`; see `NOTICE` and `LICENSE`.
