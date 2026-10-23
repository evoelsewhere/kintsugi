# Extend the Coding Agent Workflow

This is the implementation handoff for contributors, including coding agents. Read it before changing the CLI, local MCP bridge, generated harness plugins, or the in-portal guide. The member-facing setup guide lives in the portal under **Workspace → AI workflow** (`/coding-agent-workflow`).

Before structural changes, follow the repository `AGENTS.md`: start with `docs/README.md`, then read the building-block view and the runtime/member-harness concept.

## Product boundary

The developer chooses and prompts the AI harness. The Kintsugi CLI authenticates a local profile and hosts a stdio MCP process when the harness requests Kintsugi context. The AI reads the returned task brief, pinned documents, citations, current reviews and task events. The developer and AI use their normal coding and GitHub tools to change code and open a pull request. Kintsugi observes provider state, reviews evidence and continues the workflow after its human gate becomes effective.

Keep these boundaries intact:

- The CLI and MCP bridge are read-only. They do not call a model, inject text into an existing chat, edit a task or repository, create/approve/merge PRs, or decide a gate.
- The MCP process has no inbound network listener. It reads the selected profile credential from the OS credential store for each API request; the server remains responsible for authorization and Project Access.
- A plugin provides a canonical skill and local MCP configuration. It does not install hooks or edit arbitrary project instructions.
- GitHub.com is the first provider. GitHub Enterprise Server needs a tested exact version; GitLab, Bitbucket and AWS-hosted services are later adapters.
- Generated manifests and bounded package lifecycle probes do not prove a live authenticated MCP integration. Keep support claims tied to recorded evidence.

## Where to make a change

| Concern | Source of truth |
|---|---|
| Task, snapshot, citation and tool schemas | `packages/harness-sdk/` |
| Read-only context API client and CLI commands | `packages/kintsugi-client/` and `packages/cli/` |
| MCP protocol adapter, native plugin generation, setup safety and client version gates | `services/harness-hub/` |
| Canonical access plugin and task-reading skill | `packages/agents/builtin/plugins/access/` |
| Portal user guide | `apps/portal/src/pages/coding-agent-workflow.tsx` and its route/navigation entry |
| End-to-end workflow and release evidence | `docs/guides/coding-agent-workflow.md`, `docs/reference/coding-agent-workflow-compatibility.md`, and the implementation plan linked from the workflow guide |

The canonical member plugin uses the Claude Code plugin layout. The generator derives Claude manifests and portable `plugin.json` / `mcp.json` packages for other harnesses. Do not hand-write parallel `.claude/skills`, `.github/agents`, or client-specific copies of the access instructions. Extend the canonical source and generation path instead.

## Add a harness in small steps

1. Confirm the target has an official native plugin or MCP installation contract. Record its exact CLI version, operating systems and lifecycle commands. Do not infer support from manifest shape alone.
2. Extend `CodingAgentClient`, the CLI target mapping, compatibility policy and package generator together. Keep the generated process pointed at the installed Kintsugi CLI with absolute executable paths and the selected non-secret profile ID.
3. Make setup fail closed for unknown client versions. Preserve the marked Kintsugi-owned artifact root, path containment checks, symlink refusal, no-overwrite behavior, idempotent updates and explicit rollback commands.
4. Add generator tests for manifests and skill contents, compatibility tests for exact accepted/rejected versions, and setup tests for repeat runs, pre-existing user files, symlinks, failure cleanup and rollback. Keep secrets out of generated files and client config.
5. Run the client lifecycle in a disposable user profile: validate the package, add its marketplace/source, install, list, remove the plugin, remove the marketplace/source and confirm its cache is gone.
6. Run an authenticated smoke through the actual plugin-launched MCP process against a test Kintsugi installation. Verify a scoped task read, a snapshot-bound document read, revocation behavior and a denied out-of-scope request before advertising support.
7. Update the compatibility evidence, user-facing portal page and CLI reference with observed results and explicit gaps. Keep Git-provider tests separate from harness tests.

Do not enable a harness in setup until its native lifecycle is validated. Do not call the workflow end-to-end supported until the authenticated MCP smoke and required provider cases pass.

## Verification commands

Run from the repository root with the pinned package manager:

```sh
corepack pnpm --filter @kintsugi/harness-hub test
corepack pnpm --filter @kintsugi/cli test
corepack pnpm --filter @kintsugi/portal typecheck
corepack pnpm --filter @kintsugi/portal test
corepack pnpm --filter @kintsugi/portal build
```

Run focused tests first while iterating, then the relevant package checks and broader repository checks. A generated configuration test is not a substitute for the disposable native lifecycle or authenticated MCP smoke. Report any unavailable native client, provider credential, or operating-system test as unverified.

## References

- [CLI reference](../reference/coding-agent-cli.md)
- [Harness and MCP contract](../reference/harness-integration.md)
- [Compatibility evidence and release gaps](../reference/coding-agent-workflow-compatibility.md)
- [Coding Agent Workflow architecture](coding-agent-workflow.md)
- [ADR-0059: CLI and local stdio MCP](../decisions/0059-coding-agent-workflow-through-cli-and-local-mcp.md)
- [ADR-0060: Project Access and immutable context snapshots](../decisions/0060-coding-agent-context-and-project-access.md)
- [ADR-0061: PR evidence and workflow continuation](../decisions/0061-evidence-bound-pr-continuation.md)
