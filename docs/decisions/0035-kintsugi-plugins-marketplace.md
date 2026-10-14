# ADR-0035: Kintsugi plugins — one marketplace of plugins replaces the agent catalog

- Status: Accepted (phase 1 implemented; later phases planned)
- Date: 2026-10-14
- Decision register: D54
- Amends: ADR-0015 (the plugin format now also carries the runtime content), ADR-0026 (the Agent Builder becomes part of the plugin editor), ADR-0027 (the built-in content is split into plugins)

## Context
The portal lists "Agents", but what Kintsugi ships is more than agents: commands, workflows, scripts, hooks and shared skills that only make sense together. A reader cannot see how the pieces work end to end, or where to change one. Member harnesses already consume plugins in the Claude Code plugin format (ADR-0015); the runtime content had no comparable unit.

## Decision
1. **A Kintsugi plugin is a folder in the Claude Code plugin format**, extended for what the runtime runs: `.claude-plugin/plugin.json`, `agents/`, `commands/`, `skills/`, `hooks/`, plus `workflows/` and `scripts/`. One plugin is one catalog entry and carries a whole capability from the command a person starts to the output it writes.
2. **The marketplace is the catalog.** Administration → **Plugins** lists the plugins an installation has: the built-in ones shipped with the release (read-only; fork to change) and the project plugins in the document repository's `plugins/` (ADR-0028). The agent list, the shared skills and the model bindings of the Agent Builder are views inside a plugin, not a separate area.
3. **Built-in plugins.** The built-in modernization content is split by purpose, each plugin able to stand alone and declaring the shared skill it uses:
   - `understand` — the runtime plugin: commands `assess` and `understand`, the agents `legacy-analyst`, `business-rules-extractor` and `security-auditor`, their workflows and scripts, the JobOutput hook and the artifact readers.
   - `modernize` — the member plugin: commands `preflight`, `brief`, `transform`, `uplift`, `reimagine` and `verify`, the agents `test-engineer`, `uplift-migrator`, `scaffolder`, `architecture-critic` and `version-delta-analyst`, the uplift and reimagine workflows and the verification scripts.
   - Both use the shared skill `mermaid-diagrams`.
4. **Source of truth.** Built-in plugins live in this repository; a project's own plugins live in Git, in the document repository (`plugins/<name>/`), and change by pull request like every other document. Postgres keeps no plugin content; runtime jobs receive the resolved plugin content whole with each job (ADR-0023).
5. **UI.** A plugin page shows a file tree beside a read-only code view; later an editor changes the files of a project plugin and commits them through the document write path. A plugin also has an end-to-end **workflow view**: command → workflow → agents → scripts → outputs → gates, drawn from the plugin's own manifests (command metadata, workflow `meta`), so a reader sees how it works and where to develop it.

## Phases
1. *(done)* Navigation and pages: Plugins replaces Agents, a marketplace of plugin cards, a plugin page with components and files. Built-in plugins are declared by `packages/agents/builtin/plugins.json`; the files stay where the orchestrator expects them.
2. Physical layout: move each built-in plugin into its own folder in the plugin format, add `.claude-plugin/plugin.json`, validate with `claude plugin validate`, and read project plugins from the document repository.
3. Editor: edit and create project plugins in the portal, committed by pull request.
4. Workflow view per plugin.
5. Runtime resolution by plugin (an agent is `plugin:agent`), model bindings and versions per plugin.

## Consequences
- The old Agent Builder pages remain reachable from the marketplace until phase 3 folds them into the plugin editor.
- Splitting the built-in content is declarative in phase 1; moving the files is phase 2 and touches the orchestrator's script and workflow paths.
