# Use a coding agent on a migration task

The interactive setup and workflow guide is part of the Kintsugi portal: open **Workspace → AI workflow** (`/coding-agent-workflow`). This page records the architecture and operational limits behind that guide.

> Implementation status: the typed client, read-only CLI, local stdio MCP bridge, generated Coding Agent Workflow packages, browser authorization with rotating credentials, administrator-controlled connection age, GitHub PR observation/review components, event replay, evidence-bound gate publication and durable effective-gate continuation are implemented on the unreleased feature branch. The portal provides project plugin setup, connection revocation, Project Access controls, task handoff and durable gate-publication status. A synthetic API/worker smoke passed PKCE exchange, project-scoped reads, refresh rotation, Project Access revocation and connection revocation. Authenticated MCP calls through live Claude/Codex clients, authenticated GitHub provider flows (including webhooks and permissions), a tested GHES version, live provider/model behavior, crash recovery, rollback and upgrade pilots remain release gates. See the [consolidated implementation, status, testing, and release record](../development/implementation-delivery-record.md), [CLI reference](../reference/coding-agent-cli.md), and [compatibility evidence](../reference/coding-agent-workflow-compatibility.md).

You prompt and work in your chosen AI harness and keep using its existing model subscription. The Kintsugi skill guides the AI to call context tools when your request concerns a Kintsugi task, design, standards, readiness, PR, review, or gate. In the current local setup, the AI client launches the installed Kintsugi CLI as its stdio MCP bridge; the CLI handles authentication and access to Kintsugi, while your usual coding tools make changes and open the PR. Kintsugi then follows that PR through review and the human gate. See [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).

Reading task context needs a registered document repository and `member.read` plus Project Access. A configured GitHub provider is needed only when Kintsugi should observe and reconcile the PR. Your AI client needs its own repository authorization to push changes or open a PR. The current unreleased preview requires a local CLI build and a compatible local AI client; hosted chat clients need a future remote MCP connection.

## Connect once

1. For the local workspace preview, build the CLI from the Kintsugi repository root:

   ~~~sh
   corepack pnpm --filter @kintsugi/cli... build
   pnpm kintsugi --help
   ~~~

   The root `pnpm kintsugi` script launches the compiled CLI. Use the published package-manager install instructions after a CLI release.

2. In the project, open **Work in your AI**, choose your supported client and terminal, and copy the generated plugin setup command. It already includes the configured installation URL and project ID. Run it in a terminal; during the local preview, prefix it with `pnpm` from the Kintsugi repository root.

   ~~~sh
   pnpm kintsugi plugins setup --harness claude-code --url https://kintsugi.example.internal --project modernization
   ~~~

   The command installs the native plugin and creates a nonsecret local profile. It does not issue or save a credential. Start a new Claude Code or Codex session after it finishes.

3. On the first Kintsugi context request, the CLI opens a browser. Sign in, review the project, and approve access. The CLI completes a PKCE authorization through a temporary local callback, keeps five-minute access credentials in memory, and saves the rotating refresh credential in the OS credential store. Kintsugi enforces the administrator's 15- or 30-day maximum connection age. You do not create or paste a token.

4. Prompt your AI as usual. The plugin helps it retrieve task context, approved designs, standards, acceptance criteria, readiness, PR status and evidence through read-only MCP tools. Your AI uses its normal GitHub access to commit and create the PR; Kintsugi observes it through its separately configured provider connection.

For direct CLI commands outside an AI client, start browser sign-in for the selected profile:

~~~sh
kintsugi auth login --url https://kintsugi.example.internal --project modernization --profile work
kintsugi auth status --profile work
kintsugi project list --profile work
kintsugi project use modernization --profile work
~~~

The native package lifecycle has been probed with Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2. These probes do not yet verify an authenticated MCP tool call from either live AI client. Copilot packages can be generated for tests, but native setup is disabled until a native version is tested. To use an AI chat without local MCP support, export a brief and paste it into the conversation; the export is a copy and cannot be recalled after it leaves Kintsugi.

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

4. Open the usual pull request or pull requests. For a registered GitHub/GHES repository, include one machine-readable association block in each PR body. Use the `projectId`, full `unitId`, and `contextRevision` from the task brief. Include only the `requiredDeliverableIds` implemented by this PR in its repository. These values are a lookup hint; Kintsugi validates them against the observed repository, default branch, and retained snapshot, and may ask a maintainer to confirm the association.

   ~~~markdown
   <!-- kintsugi:task-association
   {"projectId":"billing-modernization","unitId":"billing-api/payments/invoice-validation","contextRevision":"sha256:<64 lowercase hex characters>","deliverableIds":["invoice-api"]}
   -->
   ~~~

   If the task brief is partial or does not supply a required value, leave the block out and report that the PR needs maintainer association. Never guess IDs or reuse a context revision from a different brief. Kintsugi discovers current GitHub state even if you close your AI session.

5. Read Kintsugi's current review findings, fix the issues in a new commit and let Kintsugi review the new revision. Findings name the reviewed revision and source lines; a finding for an older revision is marked stale.

6. Complete provider-required human reviews and merge each required code and document deliverable. The unit's effective gate is recorded separately: an authorized human decision is published as a gate-record PR that must merge and validate against the exact delivered revisions. Kintsugi continues the workflow only after that evidence is effective.

The CLI and API stream task events over authorized SSE and resume from the last delivered event ID. A first watch replays retained events for that task; the server retains seven days. An older or invalid cursor asks the AI to fetch current task status and start a new watch. The event stream is a view of workflow progress; it does not trigger provider reconciliation or continuation. Kintsugi observes provider pull requests through webhooks and polling, then continues only after the required evidence and human gate become effective.

~~~sh
kintsugi task status billing/invoices/tax --profile work
kintsugi task watch billing/invoices/tax --profile work
~~~

See the exact [commands and MCP tools](../reference/harness-integration.md), and the [client/provider compatibility evidence](../reference/coding-agent-workflow-compatibility.md).

For future harness work, read the [contributor handoff](coding-agent-workflow-contributing.md) before extending native plugin generation or setup.
