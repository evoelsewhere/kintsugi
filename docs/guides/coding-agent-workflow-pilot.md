# Test the Coding Agent Workflow locally

This guide takes the local workflow from automated smoke to a real coding-agent and pull-request pilot. The feature is implemented on the unreleased branch; the CLI is still a private workspace package, so the commands below use the repository build.

## 1. Run the automated smoke first

Use a loopback-only disposable PostgreSQL server with permission to create and drop databases. The smoke script refuses to use `.env` as a fallback, creates a uniquely named database and synthetic Git repository, and removes both when it exits.

From the repository root, build the processes and CLI:

```sh
pnpm --filter @kintsugi/cli... build
pnpm --filter @kintsugi/api build
pnpm --filter @kintsugi/orchestrator build
```

Set `KINTSUGI_TEST_DATABASE_URL` to the disposable server's maintenance database URL. For PowerShell:

```powershell
$env:KINTSUGI_TEST_DATABASE_URL = "postgresql://<user>@127.0.0.1:<port>/postgres"
pnpm run test:coding-agent:integration
pnpm run test:coding-agent:smoke
Remove-Item Env:KINTSUGI_TEST_DATABASE_URL
```

The integration runner exercises the required API and worker PostgreSQL suites. The public-process smoke starts the compiled API and worker, creates an admin, project, assigned unit, standards/evidence source and document repository, then checks browser-consent API exchange, PKCE, five-minute project-scoped access, context reads and citations, refresh rotation, metadata redaction, Git revision A/B, API restart, stale-snapshot behavior, write denial, Project Access revocation, connection revocation and cleanup. It is a model-free synthetic test; it does not launch a browser or prove an AI client's MCP integration.

The complete local checks are:

```sh
pnpm run test:coding-agent:runner
pnpm --filter @kintsugi/cli test
pnpm --filter @kintsugi/harness-hub test
pnpm --filter @kintsugi/portal test
pnpm lint
pnpm typecheck
pnpm build
```

## 2. Smoke-test browser sign-in with the existing project

Keep the `Test` project's document repository unchanged. It is appropriate for checking project consent, an empty task list, connection listing and revocation. It does not prove task or document retrieval when it has no assigned task.

1. Start the local Docker-backed Kintsugi stack using the [installation guide](installation.md). Confirm the portal, API, worker and Postgres are healthy.
2. As an administrator, open **Settings → Security** and choose the 15-day connection-age policy. Confirm an account without `security.manage` cannot change the setting or inspect other users' connections.
3. Confirm the test member has `member.read` and explicit Project Access to `Test`.
4. In the portal's project Coding Agent Workflow setup, choose Claude Code or Codex and copy the generated install command. It supplies the configured Kintsugi URL, project ID and a local profile. Run it from the Kintsugi repository root with the workspace CLI prefix (`pnpm kintsugi`) while the package remains unpublished. Do not run `auth login` first; installing the plugin creates no credential.
5. Start a new client session. Ask it to list tasks it can access in `Test`. First use should open the Kintsugi browser consent page. Sign in, check that the named client and `Test` project match, and approve. The authorized project should appear and the task list should be empty.
6. Revoke the connection from the member's Coding Agent Workflow access page. Ask the client to list tasks again; the next Kintsugi request should be denied and require sign-in. This confirms server-side revocation reaches an already-running client.

Use a disposable client profile and separate operating-system account/keyring when practical. Record the exact OS, Node, Kintsugi CLI and AI client versions, and which credential store was used. The workspace smoke does not substitute for this live-client check.

## 3. Test task, standards and evidence context

Use a separate disposable project and repositories for content retrieval. Follow [Build a project](build-project.md) and the [document repository layout](../reference/document-repo.md) to register a throwaway document repository and a throwaway code repository. Do not add fixtures to `falo-be` or another project repository.

Add a small synthetic task assigned to the test member using the project's normal task/unit flow. Include a distinctive but harmless sentence in its task brief, one short standard under `01-standards/`, one design or evidence document under the unit's document paths, and a second project the test member cannot access. Allow the worker to sync the document repository, then confirm the task appears under the member's assigned tasks in the portal.

Install the generated plugin command for this project, approve its browser request, and ask the AI to:

- explain the task and identify blockers;
- summarize the standard and design/evidence document with source paths and line citations;
- fetch the same document through the task's pinned snapshot;
- report that the second project's marker is unavailable.

The AI should cite only returned Kintsugi sources. Confirm that the MCP connection cannot edit a task, document, repository, Project Access grant or pull request. Revoke it and verify the next context request fails.

## 4. Run a separate GitHub pull-request pilot

Only do this after the synthetic context pilot passes. Configure Kintsugi's GitHub provider for the disposable repositories and verify its repository and webhook/polling permissions. The developer's AI client uses its normal GitHub login to create a branch and open the PR; Kintsugi's project-scoped connection does not grant GitHub access.

Use the project and task association values from the task brief, open a small PR in the disposable code repository, and verify Kintsugi associates it with the intended task, shows the current PR/review status and records subsequent review events. Close the PR and revoke the Kintsugi connection when done. Do not use the production `falo-be` repository for this pilot.

## What is proven on this branch

Automated API/worker OAuth and context smoke, required database integration suites, CLI and Harness Hub tests, portal tests, lint, typecheck and build have passed locally. Native plugin lifecycle probes exist for Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2, but an authenticated MCP call from either real client, a live GitHub.com/GitHub Enterprise PR pilot, and package publication have not been verified. See the [compatibility evidence](../reference/coding-agent-workflow-compatibility.md) and [consolidated delivery record](../development/implementation-delivery-record.md) for current results and release gates.
