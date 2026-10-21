# Use a coding agent on a migration task

> Implementation status: the typed client, read-only CLI, local stdio MCP bridge and generated Coding Agent Workflow packages are implemented in the unreleased workspace. Native package setup is version-gated; PR continuation and streaming remain planned. See the [CLI reference](../reference/coding-agent-cli.md) for exact setup behavior.

You work in your chosen AI harness and keep using your existing model subscription. Kintsugi supplies the authorized task and design context, then follows your normal pull request through review and the human gate. See [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).

## Connect once

1. Install the Kintsugi CLI using the release instructions for your operating system.
2. Sign in to your Kintsugi installation. The token is entered privately and stored in the operating system's credential manager.

   ~~~sh
   kintsugi auth login --url https://kintsugi.example.internal --profile work
   kintsugi auth status --profile work
   ~~~

3. List your projects and choose the one you are working in.

   ~~~sh
   kintsugi project list --profile work
   kintsugi project use modernization --profile work
   ~~~

4. Generate a local Coding Agent Workflow plugin package for a tested AI client. It gives the AI read-only Kintsugi tools and a short guide for retrieving complete cited context. The CLI prints the client's native marketplace/install commands; run those commands yourself to change client settings. Package generation does not install a Kintsugi assistant or run hooks.

   ~~~sh
   kintsugi plugins setup --client claude --profile work
   ~~~

   The native package lifecycle has been probed with Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2. These probes do not yet verify an authenticated MCP tool call against a live Kintsugi installation. Copilot packages can be generated, but setup stays disabled until a native version is tested. To use an AI chat without MCP tools, export a brief and paste it into the conversation; export is a copy and cannot be recalled after it leaves Kintsugi.

## Work on a task

1. Find tasks assigned to your signed-in identity, or list tasks ready for a particular activity.

   ~~~sh
   kintsugi task list --mine --profile work
   kintsugi task list --ready-for implementation --profile work
   ~~~

2. Ask your chosen AI to explain the task. The access skill asks it to fetch the brief, retrieve every required section, cite its sources, and identify unresolved decisions or blockers. Listing or reading a task does not claim it.

   ~~~sh
   kintsugi task brief billing/invoices/tax --profile work
   ~~~

   If a design is missing, draft work may still be ready while implementation is blocked. Ask the task owner about a decision the brief marks unresolved instead of asking the AI to guess.

3. Work in the code and document repositories. Follow the brief's approved designs and standards. The AI can retrieve sections from the same pinned snapshot as the brief and can refresh context when Kintsugi reports a newer relevant revision.

4. Once PR continuation ships, open the usual pull request or pull requests. Include the full Kintsugi unit identity and the deliverable paths so the provider change can be associated with the task. Kintsugi is planned to discover current GitHub state even if you close your AI session.

5. Read Kintsugi's current review findings, fix the issues in a new commit and let Kintsugi review the new revision. Findings name the reviewed revision and source lines; a finding for an older revision is marked stale.

6. Complete provider-required human reviews and merge each required code and document deliverable. The unit's effective gate is recorded separately: an authorized human decision is published as a gate-record PR that must merge and validate against the exact delivered revisions. Kintsugi continues the workflow only after that evidence is effective.

After the streaming milestone ships, you will be able to check progress in the portal or stream it from the CLI. The current `task watch` command reports `UNSUPPORTED_CAPABILITY`.

~~~sh
kintsugi task status billing/invoices/tax --profile work
kintsugi task watch billing/invoices/tax --profile work
~~~

See the exact [commands and MCP tools](../reference/harness-integration.md), and the [client/provider compatibility evidence](../reference/coding-agent-workflow-compatibility.md).
