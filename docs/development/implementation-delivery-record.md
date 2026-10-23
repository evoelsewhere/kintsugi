# Engineering implementation and verification record

Updated: 23 October 2026

This page consolidates the approved design, implementation status, remaining work, known issues, test plan, and recorded evidence for the Coding Agent Workflow and the GHCR/SSH deployment work. It replaces the dated implementation notes as the maintained delivery record.

The member-facing instructions remain in the Kintsugi portal under Developer Documents → Coding Agent Workflow. Stable product contracts remain in the ADRs and reference pages linked below. Update this page when implementation status or verification changes; do not create another dated status plan.

## Coding Agent Workflow

### Goal and approved flow

A developer installs a project-scoped Kintsugi plugin, signs in through Kintsugi, asks their chosen AI about project context, works in the repository with the AI's normal GitHub access, and opens a pull request. Kintsugi observes the PR and advances the existing review and human-gate workflow.

1. An administrator grants the member Project Access and configures the maximum connection age.
2. From the project workflow page, the developer copies the generated install command. It supplies the configured Kintsugi URL and project ID.
3. The Kintsugi CLI prepares and installs the selected local plugin. Codex Desktop uses the CLI to stage a package in its personal marketplace; the developer then installs it in the Codex app. Claude Code uses its native plugin lifecycle.
4. On first use, the local plugin launches the CLI as an stdio MCP process. The CLI opens Kintsugi sign-in with PKCE. The member reviews and approves the named project.
5. Kintsugi issues a short-lived access token and rotating refresh credential. The CLI keeps the access token in memory and stores the refresh credential in the operating system credential store. The administrator's 15- or 30-day connection-age policy controls when sign-in is required again.
6. The AI reads authorized tasks, design, standards, evidence, reviews, and status through read-only MCP tools. It cites the retrieved source context and identifies unresolved decisions.
7. The developer and AI use the developer's existing repository access to change code and create a PR. Kintsugi's separately configured GitHub provider observes PR and review state and publishes workflow progress.

The Kintsugi connection does not write tasks, repositories, or GitHub state; it cannot approve gates or merge PRs. The first provider is GitHub.com. GitHub Enterprise Server needs a version-specific pilot; GitLab, Bitbucket, and AWS-hosted services are later provider adapters. Hosted AI surfaces that cannot launch the local stdio process need a separate remote MCP transport.

### Canonical decisions and references

- [ADR-0061: local CLI and stdio MCP](../decisions/0061-coding-agent-workflow-through-cli-and-local-mcp.md)
- [ADR-0062: context, Project Access, and snapshots](../decisions/0062-coding-agent-context-and-project-access.md)
- [ADR-0063: PR evidence and workflow continuation](../decisions/0063-evidence-bound-pr-continuation.md)
- [ADR-0065: project-scoped browser authorization](../decisions/0065-project-scoped-oauth-for-coding-agent-workflow.md)
- [ADR-0066: Codex Desktop plugin installation](../decisions/0066-codex-desktop-plugin-installation.md)
- [Coding Agent Workflow architecture and member use](../guides/coding-agent-workflow.md)
- [Local pilot walkthrough](../guides/coding-agent-workflow-pilot.md)
- [Contributor handoff](../guides/coding-agent-workflow-contributing.md)
- [CLI commands](../reference/coding-agent-cli.md)
- [MCP and harness contract](../reference/harness-integration.md)
- [Compatibility evidence](../reference/coding-agent-workflow-compatibility.md)

### Implementation status

| Area | Status | Evidence boundary |
|---|---|---|
| Project Access and authorized context reads | Implemented | API checks member status, permission, and current project access for each request. Task context uses pinned document snapshots and citations. |
| Typed client and CLI | Implemented | Read-only task/project/document/review/status commands and event watch are present. Credentials use the OS secure store; profiles contain non-secret configuration. |
| Local stdio MCP bridge | Implemented | The bridge is launched by the AI client and has no inbound listener. MCP stdout is reserved for protocol messages. |
| Claude Code plugin | Package lifecycle validated for Claude Code 2.1.278 | Disposable profile validation and install/removal passed. Authenticated MCP calls from a live Claude session remain unverified. |
| Codex CLI plugin | Package lifecycle validated for Codex CLI 0.163.0-alpha.10.2 | Disposable marketplace/install/removal passed, including removal of the versioned plugin cache. Authenticated MCP calls from a live Codex CLI session remain unverified. |
| Codex Desktop route | Package staging and automated checks implemented | The app's Plugins Directory install, first-use browser approval, and authenticated MCP request remain to be completed in the real desktop UI. |
| Browser authorization | Implemented locally | PKCE, project consent, five-minute access tokens, refresh rotation, revocation, and administrator connection-age policy have synthetic API/process coverage. |
| GitHub PR observation, review evidence, gate publication, events, and portal status | Implemented locally | Automated and synthetic integration evidence exists. Live authenticated provider permissions, webhook behavior, and complete recovery remain release checks. |
| Release support matrix | In progress | Current native evidence is bounded to package lifecycle on Windows. It does not establish end-to-end client support or Linux/macOS support. |

The feature is a local implementation preview. Do not describe a client/provider pair as fully supported until its authenticated MCP and end-to-end cases pass on the exact recorded versions and operating system.

### Remaining implementation and release work

1. Run the Codex Desktop pilot: prepare the package, install it through the app's Plugins Directory, restart, sign in, approve the exact project, retrieve a task, and verify revocation from the same disposable profile.
2. Run the equivalent authenticated MCP retrieval through a disposable Claude Code profile.
3. Complete a synthetic GitHub.com workflow with a disposable repository and project: create a PR using the developer's normal GitHub credential, verify Kintsugi observes the PR and review updates, then verify the correct evidence and human gate determine continuation.
4. Capture dated, redacted evidence for each pilot: Kintsugi page state, native plugin state, consent, successful task/document citations, denied write or out-of-scope access, PR/review state, and gate status. Record client, OS, Node, package, and source revision.
5. Re-run the required API/worker integration suites and focused package checks on the current feature head using the repository-pinned pnpm version. Record test counts and skipped cases.
6. Validate rollback, upgrade, crash/restart recovery, and secure credential storage on every OS/client row advertised.
7. Publish a pinned CLI artifact before asking ordinary developers to use package-manager installation. The workspace package remains private; a local build is required for the current preview.
8. Probe an exact GitHub Enterprise Server version before advertising GHES. Keep other Git providers and remote MCP as separate future work.

### Test plan and acceptance criteria

| Test area | Required cases | Pass condition |
|---|---|---|
| Authentication and authorization | No credential; PKCE state/replay/mismatch; callback timeout/cancel; project consent; refresh rotation/reuse; 15/30-day age; policy reduction; revocation; disabled member; removed Project Access | No data before consent; only consented project data is readable; revocation and access changes deny the next request; secrets never enter profiles, logs, or MCP stdout. |
| Context integrity | Assigned task; task brief; basic/detailed design; standards; evidence; citations; pinned snapshot after source changes/restart; oversized mandatory section; malformed/foreign paths; stale/missing snapshot | Every claim maps to an authorized source and pinned revision; incomplete or stale context is explicit; no HEAD fallback or cross-project disclosure. |
| Read-only contract | Attempt task claim/write, gate approval, repository write, PR merge, or unauthorized legacy route | Writes are unavailable or denied, and no operation changes Kintsugi or repository state. |
| CLI and MCP process | JSON success/error; no-input behavior; redaction; private CA; OS credential-store failure; MCP stdio framing; SSE replay/resume; denied request after revocation | Correct exit/status behavior, protocol-only stdout, actionable stderr, no credential leakage, and event replay without gaps. |
| Plugin packaging | Exact client version gates; generated manifests and icons; safe paths; symlink/conflict/malformed marketplace handling; idempotent install/update/remove/rollback | Only Kintsugi-owned files change; user marketplace entries survive; unsupported versions fail closed; rollback removes plugin and cache. |
| Portal | Generated command values; prerequisites; login timeout/cancel; successful callback; project consent; connection age/revocation; desktop route; diagrams and keyboard navigation | Instructions are readable and truthful, commands use configured project/URL, diagrams render, and no state implies a live pilot that has not run. |
| GitHub provider and workflow | PR association; open/update/close; reviews/checks; webhook and polling; downtime recovery; exact evidence; gate publication/merge; continuation replay | Kintsugi observes provider state, binds evidence to exact revisions, and continues once only after the authorized human gate is effective. |
| Native client pilot | Claude Code and Codex Desktop/CLI, using disposable client profiles and test project | The real client launches the bridge, browser consent succeeds, authorized citations are correct, forbidden writes are unavailable, and revocation blocks the next read. |
| Deployment and operations | Fresh install, upgrade, restart, rollback, secret-store setup | The advertised deployment path works without losing persistent data or exposing credentials. |

Automated coverage is necessary but does not substitute for native app, browser, provider, or user-flow evidence. Run provider and native-client pilots only with disposable identities, projects, profiles, and repositories.

### Local smoke procedure

Use the existing Docker-backed Kintsugi database. Keep the existing Test project's document repository unchanged; it has no tasks and is suitable only for connection, project-list, empty-task-list, and revocation checks. Use a separate synthetic disposable project and document repository for task and PR cases.

1. Start the local Compose services and verify the portal, API, worker, and PostgreSQL are healthy.
2. Set the administrator connection-age policy to 15 days; verify a regular member cannot change it. Give the test member member.read and Project Access only to the Test project.
3. Install the plugin before signing in using the command generated by the Kintsugi project page. Do not create or paste a token.
4. Start a new supported client session. Complete browser sign-in and consent for Test. Read the project list and empty task list.
5. Revoke the connection and confirm the next MCP read is denied. Remove Project Access and confirm that access is denied on the next request.
6. Create a separate synthetic project with a task brief, standards, design, evidence, and a second ungranted project. Confirm the AI cites the correct documents and cannot retrieve the second project's marker.
7. Use the disposable synthetic repo and the AI client's normal GitHub authorization to create a task-associated PR. Confirm Kintsugi's provider observation, latest revision, review result, gate publication status, and continuation.
8. Capture screenshots and redacted test reports for the portal, client plugin, consent, citations, denial, PR, review, and gate states. Record exact versions and clean up only the synthetic resources.

The model-free process smoke is run with:

~~~sh
corepack pnpm build
pnpm run test:coding-agent:smoke
~~~

Required API/worker database integration is run with an explicit disposable PostgreSQL URL:

~~~sh
node scripts/run-member-integration.mjs --suite all
~~~

Never use the production/user database as a test target. Do not include credentials, access tokens, refresh tokens, or private task contents in screenshots or reports.

### Recorded verification and known limits

Evidence below comes from local worktree runs recorded on 22–23 October 2026. Counts from separate runs are not additive, and results from an earlier base do not replace a current-head rerun.

| Check | Recorded result | Remaining limit |
|---|---|---|
| API/worker synthetic integration | OAuth/context runs passed 61 API and 85 worker integration tests with a disposable database. Other focused current-head snapshots recorded 42 API and 73 worker tests. | Re-run on the current merged feature head with pinned pnpm before release. |
| Public-process OAuth/context smoke | Passed with synthetic PostgreSQL/Git data; covered PKCE, scoped reads, refresh rotation, snapshot behavior, write denial, revocation, and cleanup. | Does not prove live client sign-in or provider behavior. |
| Package, portal, and client tests | A Codex Desktop preparation run recorded Hub 22, CLI 155, portal 80, client 34, OAuth API 10; focused portal install/diagram checks passed 12. Typecheck, lint, build, and diff checks passed for those packages. | These are local recorded runs, not a complete current-head CI or real desktop pilot. |
| Claude Code and Codex CLI native lifecycle | Marketplace/plugin install and removal passed in disposable Windows profiles for the exact versions in the compatibility record. | No authenticated tool call through either AI client; no Linux/macOS secure-store pilot. |
| Codex Desktop app | Local marketplace package staging passed idempotently. | The app's plugin browser, visual icon, first-use authorization, and task fetch are pending. |
| GitHub and GHES | GitHub.com is the first provider and synthetic fixtures cover provider contracts. | Authenticated GitHub permission/webhook/recovery evidence and an exact GHES version remain release gates. |
| Root test baseline | A prior Windows baseline run exposed an existing runtime shell test assumption about HOME; it is documented in the compatibility record. | Do not count it as a Coding Agent Workflow regression; resolve or isolate it before claiming a clean full root test run. |

The sequence-diagram null-root error was reported during earlier guide work. The focused guide diagram checks passed in the recorded portal run; still verify the rendered guide in the real portal during the browser/keyboard pilot.

### Resolved review findings

The following implementation findings were corrected and have focused coverage: readiness lookup for a task-list pagination row; initial SSE event replay after reconnect; task brief idempotency metadata when it creates a temporary snapshot; streaming behavior with a private CA; Windows .cmd client-version detection; and Codex rollback removing the installed plugin and its versioned cache before marketplace cleanup.

## GHCR and SSH deployment

### Intent and constraints

Build Kintsugi app and worker images from the monorepo, publish commit-tagged images to GHCR, and deploy that exact revision to the configured self-hosted Docker Compose host over SSH. Keep the app, worker, and PostgreSQL topology; run app and worker as non-root; mount runtime data read-only in the app and writable by the worker; keep credentials in GitHub Actions secrets and pin the SSH host key.

First-time host provisioning, Docker/firewall/DNS/TLS setup, and installation-specific database/bootstrap values remain operator tasks. The workflow does not add infrastructure or change the single-host Compose architecture.

### Status and verification

The recorded implementation completed the app and worker images, GHCR publishing workflow, commit-SHA tags, SSH deploy gating, configuration validation, pinned known-hosts, Compose bundle transfer, operator setup guide, and ADR decision. Recorded checks built the API/portal and container targets, validated Compose interpolation with temporary non-secret values, parsed the workflow YAML, and reviewed secret handling.

A real deployment still depends on the repository's configured variables/secrets and a provisioned host. See [ADR-0039](../decisions/0039-github-actions-ghcr-deployment.md), the [installation guide](../guides/installation.md), and the [Compose operator guide](../../deploy/compose/README.md) for stable deployment instructions.

## Maintenance

This is the single maintained delivery record for the implementation status and test evidence of the workstreams above. Keep stable architectural decisions in ADRs, exact command contracts in reference pages, and member instructions in the portal guide. Leave detailed agent planning drafts local; do not add another dated plan or progress log to the repository.
