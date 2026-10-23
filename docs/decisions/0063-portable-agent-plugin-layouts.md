# ADR-0063: Generate portable Agent Plugins packages for Codex and Copilot

- Status: Accepted
- Date: 2026-10-22
- Decision register: D19, D78
- Supersedes: the Codex package manifest layout in ADR-0015; the canonical Kintsugi asset source format is unchanged.

## Context

Kintsugi authors member plugin assets in its canonical Claude Code plugin format (ADR-0015), then generates a small Coding Agent Workflow package for each supported client. The [Claude Code plugin format](https://code.claude.com/docs/en/plugins) uses `.claude-plugin/plugin.json` and `.mcp.json`; Kintsugi emits those files for Claude Code, and root `plugin.json` and `mcp.json` for Codex and GitHub Copilot CLI. The CLI generates these files under the selected local Kintsugi profile because each package embeds the developer's local CLI launcher path and profile ID; the package is not a static set of files committed to the Kintsugi repository.

The older Codex layout recorded in ADR-0015 uses `.codex-plugin/plugin.json` and `.mcp.json`. Current [Codex packaging guidance](https://developers.openai.com/plugins/build/plugins) describes root `plugin.json`, root `mcp.json` and `skills/` as the portable Agent Plugins layout, with `.codex-plugin/plugin.json` as an optional compatibility fallback for Codex-specific settings. [GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) also supports the portable Agent Plugins format. Kintsugi's current package has no Codex-only metadata that needs that fallback.

## Decision

1. Keep Claude Code as the canonical authoring format for Kintsugi plugin source assets.
2. Generate Claude Code packages with `.claude-plugin/plugin.json`, `.mcp.json` and `skills/`.
3. Generate Codex and GitHub Copilot CLI packages with root `plugin.json`, root `mcp.json` and `skills/`, using the portable Agent Plugins schema and each client's tested marketplace layout.
4. Do not generate `.codex-plugin/plugin.json` by default. Add the optional compatibility manifest only when a required Codex-specific capability cannot be represented through the portable root manifest and its documented extension mechanism, and cover that behavior with versioned compatibility tests.
5. Keep package identity and portable skill/MCP content aligned across client outputs. Client-specific manifests and installation commands remain generated target adapters; the local MCP transport and server authorization are independent of manifest layout.

## Consequences

- Claude, Codex and Copilot receive packages in formats each can discover natively, while Kintsugi keeps one reviewed source skill.
- The generated Codex package avoids a redundant compatibility manifest when it has no Codex-only settings. If client-specific OpenAI metadata is added, it must follow the current overlay precedence rules and must not be assumed to merge with a root `extensions.com.openai` object.
- Manifest paths and marketplace paths must remain covered by generator tests and exact-client compatibility probes. The existing Codex lifecycle probe validates marketplace and plugin install/list/removal; it does not prove an authenticated MCP tool call. Authenticated client calls remain a release gate.
- Revisit this decision when the portable schema or supported client versions change.

## Alternatives considered

- **Emit only `.codex-plugin/plugin.json` for Codex.** Rejected for new packages because it selects the compatibility layout instead of the current portable package structure.
- **Emit both root and `.codex-plugin` manifests.** Rejected by default because it creates duplicate metadata and client-specific precedence behavior without a current need.
- **Use the Claude manifest for every target.** Rejected because each client has different package discovery and MCP configuration rules.
