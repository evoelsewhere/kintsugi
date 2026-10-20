# Work on a migration task as a member

> Planned behavior. The CLI, local MCP connection and PR continuation described here are being implemented. Commands become available with a released member-access package.

You work in your chosen AI harness and keep using your existing model subscription. Kintsugi supplies the authorized task and design context, then follows your normal pull request through review and the human gate. See [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).

## Connect once

1. Install the Kintsugi CLI using the release instructions for your operating system.
2. Sign in to your Kintsugi installation. The token is entered privately and stored in the operating system's credential manager.

   ~~~sh
   kintsugi auth login --url https://kintsugi.example.internal
   kintsugi auth status
   ~~~

3. List your projects and choose the one you are working in.

   ~~~sh
   kintsugi project list
   kintsugi project use modernization
   ~~~

4. Set up the access plugin for a tested AI client. It gives the AI read-only Kintsugi tools and a short guide for retrieving complete cited context. It does not install a Kintsugi assistant or run hooks.

   ~~~sh
   kintsugi plugins setup --harness claude-code
   ~~~

   Claude Code is the first full pilot. Codex and Copilot CLI will be listed as supported after their own setup and protocol tests pass. To use an AI chat without MCP tools, export a brief and paste it into the conversation; export is a copy and cannot be recalled after it leaves Kintsugi.

## Work on a task

1. Find tasks assigned to your signed-in identity, or list tasks ready for a particular activity.

   ~~~sh
   kintsugi task list --mine
   kintsugi task list --ready-for implementation
   ~~~

2. Ask your chosen AI to explain the task. The access skill asks it to fetch the brief, retrieve every required section, cite its sources, and identify unresolved decisions or blockers. Listing or reading a task does not claim it.

   ~~~sh
   kintsugi task brief billing/invoices/tax
   ~~~

   If a design is missing, draft work may still be ready while implementation is blocked. Ask the task owner about a decision the brief marks unresolved instead of asking the AI to guess.

3. Work in the code and document repositories. Follow the brief's approved designs and standards. The AI can retrieve sections from the same pinned snapshot as the brief and can refresh context when Kintsugi reports a newer relevant revision.

4. Open the usual pull request or pull requests. Include the full Kintsugi unit identity and the deliverable paths so the provider change can be associated with the task. Kintsugi discovers current GitHub state even if you close your AI session.

5. Read Kintsugi's current review findings, fix the issues in a new commit and let Kintsugi review the new revision. Findings name the reviewed revision and source lines; a finding for an older revision is marked stale.

6. Complete provider-required human reviews and merge each required code and document deliverable. The unit's effective gate is recorded separately: an authorized human decision is published as a gate-record PR that must merge and validate against the exact delivered revisions. Kintsugi continues the workflow only after that evidence is effective.

You can check progress in the portal or stream it from the CLI:

~~~sh
kintsugi task status billing/invoices/tax
kintsugi task watch billing/invoices/tax
~~~

See the exact [commands and MCP tools](../reference/harness-integration.md), and the [client/provider compatibility evidence](../reference/member-access-compatibility.md).
