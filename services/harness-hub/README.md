# services/harness-hub

Bridge between Kintsugi and the AI harnesses members run on their own machines (Claude Code, GitHub Copilot, Codex, ChatGPT, …). Implements the contracts in `packages/harness-sdk`.

| Capability | Description |
|---|---|
| Kintsugi MCP server | Remote Streamable HTTP on `kintsugi-app`, Personal Access Token auth (OAuth once Entra ID is enabled): `kb.*`, `task.*`, `artifact.register`, `gate.status`, `guideline.get`. Bundled in the built-in `kintsugi` plugin |
| Plugins & marketplaces | Validates project plugins from the document repo's `plugins/` (Claude Code plugin rules), vendors the built-in plugin, and generates marketplace files in the document repo: Claude Code / Copilot CLI / Codex (ADR-0015) |
| Fallback rendering | `AssetRenderer` per harness without plugin support: skills, agents, project context, MCP config |
| CLI API | Backend for the `kintsugi` CLI (`plugins setup`, `task start`, `artifact register`, `hook <event>`) |
| Policy distribution | `HarnessPolicy` → managed settings / org policies per harness |
| Telemetry ingest | Plugin hooks, optional OTLP endpoint, vendor metrics API pollers, git/PR polling or webhooks → `HarnessActivity` |

Deliverables are never uploaded to Kintsugi: members commit them to Git, and `artifact.register` records `repo@commit:path` plus provenance (harness, AI share) — ADR-0007.

Vendor plugin formats and native paths change often. Verify them against current vendor docs when implementing each generator or renderer.
