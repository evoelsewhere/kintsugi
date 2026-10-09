# services/harness-hub

Bridge between Kintsugi and the AI harnesses members run on their own machines (Claude Code, GitHub Copilot, Codex, ChatGPT). Implements the contracts in `packages/harness-sdk`.

| Capability | Description |
|---|---|
| Kintsugi MCP server | Remote Streamable HTTP on `kintsugi-app`, Personal Access Token auth (OAuth once Entra ID is enabled): `kb.*`, `task.*`, `artifact.register`, `gate.status`, `guideline.get` |
| CLI API | Backend for the `kintsugi` CLI (`task start`, `assets pull`, `artifact register`) |
| Asset rendering | `AssetRenderer` per harness: skills, project context, roles, task packs, MCP config |
| Policy distribution | `HarnessPolicy` → managed settings / org policies per harness |
| Telemetry ingest | Optional OTLP endpoint + vendor metrics API pollers + git/PR polling or webhooks → `HarnessActivity` |

Deliverables are never uploaded to Kintsugi: members commit them to Git, and `artifact.register` records `repo@commit:path` plus provenance (harness, AI share) — ADR-0007.

Harness-native paths and policy mechanisms change often — verify against current vendor docs when implementing each renderer (ADR-0005).
