# Harness integration

Status: The unreleased workspace includes the typed client, read-only CLI/export, local stdio MCP bridge, generated client packages, browser authorization with rotating credentials, an administrator-controlled connection-age policy, GitHub PR observation/review components, authorized task-event replay with `kintsugi task watch`, evidence-bound gate publication and effective-gate continuation. Authenticated GitHub.com provider flows are not yet proven; GHES is unprobed and needs an exact tested server version. Native package setup remains version-gated, and authenticated MCP calls from the supported clients remain unverified. API and SDK changes must ship together; their strict version-1 schemas are still pre-release, and `latestContinuation` is part of that contract before its first release. After v1 ships, closed-schema response additions require a versioned or capability-negotiated contract. See the [CLI reference](coding-agent-cli.md) and [compatibility evidence](coding-agent-workflow-compatibility.md) for build instructions and current results.

Kintsugi gives context to the developer's chosen AI. The AI reads the task, design, standards and evidence documents, then answers the developer with citations. Kintsugi does not need to run its own conversational model. The Coding Agent Workflow plugin is separate from project method plugins such as modernization content ([ADR-0060](../decisions/0060-coding-agent-workflow-through-cli-and-local-mcp.md)).

## Connection path

The developer installs the project plugin before signing in. `kintsugi plugins setup --harness <client> --url <installation> --project <project>` writes a nonsecret local profile and package, then invokes the client's native plugin setup commands. The CLI starts a local stdio MCP process when the AI client asks for tools. If no credential exists, first use opens a browser for Kintsugi sign-in and explicit project consent, then exchanges a PKCE code over a temporary loopback callback. The CLI keeps five-minute access tokens in memory and a rotating refresh credential in the OS credential store; Kintsugi applies the administrator's 15- or 30-day connection limit. The process has no inbound listener and calls the same typed Coding Agent Context API. Hosted AI chats cannot launch this local process and need a future hosted HTTP MCP endpoint with remote authentication.

Claude Code is the first client target, and Codex now has a bounded native package lifecycle probe. Neither is yet a complete authenticated MCP pilot. Copilot CLI is a distinct target; support is claimed only after each exact client version passes authentication, setup, protocol, upgrade and removal checks. See the [compatibility record](coding-agent-workflow-compatibility.md).

The Coding Agent Workflow plugin contains one canonical small skill and generated client-specific MCP configuration. Claude Code receives `.claude-plugin/plugin.json` and `.mcp.json`; Codex and Copilot CLI receive the portable Agent Plugins root `plugin.json` and `mcp.json`. The Codex marketplace is `.agents/plugins/marketplace.json`; its `.codex-plugin/plugin.json` compatibility manifest is omitted because this package has no Codex-only metadata. See [ADR-0063](../decisions/0063-portable-agent-plugin-layouts.md) and the [generator tests](../../services/harness-hub/test/plugins.test.ts).

These files are generated on the developer's machine under a profile-specific `plugins/coding-agent-workflow/` directory. The MCP manifest includes that installation's local CLI path and profile ID, so the generated package is intentionally local. The setup command executes the client-native marketplace and install commands; after installation and a client restart, the AI client starts the CLI as its stdio MCP process when it needs Kintsugi context. The skill metadata helps the model recognize task/design/status requests and select tools, while the server enforces authorization. The plugin has no hooks and does not edit arbitrary project instructions. Optional method plugins stay in the project document repository and are installed separately.

## Implemented context API

All routes below use Kintsugi's normal response envelope and require the catalog permission `member.read`, explicit token scope metadata and current Project Access. A session alone does not bypass project checks. Project listing intersects the token's project IDs with the user's current grants.

| GET path under `/api/member/v1` | Result |
|---|---|
| `/projects` | Authorized projects with a stable cursor |
| `/tasks?projectId=…` | Validated Git tasks; optional `mine`, `readyFor`, `limit` and `cursor` |
| `/task-brief?projectId=…&unitId=…&activity=…` | Bounded, cited context and immutable snapshot handle |
| `/documents?projectId=…&unitId=…&snapshotId=…&sourceId=…` | One registered source/section at the snapshot revision |
| `/search?projectId=…&unitId=…&snapshotId=…&query=…` | Bounded keyword matches with citations |
| `/task-status?projectId=…&unitId=…` | Work-item status, next action, observation availability and optional latest continuation guidance |
| `/reviews/:reviewId?projectId=…` | Authorized current review findings and evidence |

Use the full `application/module/unit` identity in `unitId`, encoded as a query value. Documents accept registered source IDs rather than arbitrary paths or URLs. Read tokens cannot issue tokens, change Project Access, claim tasks or call legacy session routes.

Current `TaskStatus.evidenceAvailability` reports both pull-request and review readers as `available`; empty arrays mean no matching confirmed PR or current review was returned. Each gate status carries its authoritative `unitId` and `gateId`, with publication states kept separate from the decision result. A missing publication remains `unknown`; source approval is fail-closed until trustworthy evidence readers exist.

When a `task.continuation` event remains within the seven-day retention window, `TaskStatus.latestContinuation` returns the newest event for that exact task. It is a historical workflow notification: `TaskStatus.status` and `TaskStatus.nextAction` provide current workflow status; the task brief provides cited context. The portal and client should identify the event time and ask the developer to refresh task context before acting; continuation guidance never grants approval or creates a task.

Snapshot failures put a stable code and `snapshotId` in the error envelope's `details`:

| Code | HTTP status | Recovery |
|---|---|---|
| `SNAPSHOT_PREPARING` | 409 | Wait at least `retryAfterMs`, then retry the brief with the returned `snapshotId` |
| `SNAPSHOT_EXPIRED` | 410 | Request a new brief without the old handle |
| `SNAPSHOT_UNAVAILABLE` | 409 | Request a new brief; if retention continues to fail, check worker/mirror health |

Every retry rechecks authorization. A valid historical snapshot remains readable when newer context is invalid or oversized; its freshness is reported as stale when currentness cannot be established.

## CLI commands and current limits

CLI and MCP operations do not edit tasks, project documents, repositories or permissions. Local profile sign-in/selection and explicit file export write local state; `task_brief` may create a temporary server-side context snapshot. Output can be text, JSON or Markdown. `mcp serve` exposes the same typed HTTPS context API through a local stdio process; generated client packages and native setup commands are available for version-gated clients.

| Command | Purpose |
|---|---|
| kintsugi plugins setup --harness claude-code --url URL --project ID | Generate and install a project plugin without signing in; exact-version gated |
| kintsugi auth login --url URL --project ID | Start browser sign-in for direct CLI use |
| kintsugi auth status / logout | Show connection state or revoke and remove the selected local credential |
| kintsugi project list / use ID | List authorized projects and select a local default |
| kintsugi task list --mine | List tasks assigned to the authenticated stable user identity |
| kintsugi task list --ready-for implementation | List tasks whose current inputs allow the requested activity |
| kintsugi task brief UNIT | Print the task, readiness blockers, required context index and citations |
| kintsugi task brief UNIT --format markdown --output FILE | Explicitly export a private, source-referenced brief |
| kintsugi document get UNIT --snapshot ID --source ID --section ID | Fetch a cited document section from the pinned snapshot |
| kintsugi document search UNIT --snapshot ID --query TEXT | Bounded keyword search inside the pinned context |
| kintsugi review list --task UNIT / review get ID | Find current authorized review references and retrieve actionable findings |
| kintsugi task status UNIT | Read current task and relevant PR/gate state |
| kintsugi task watch UNIT | Stream and resume authorized task events over seven-day SSE replay |
| kintsugi doctor | Check the local runtime/profile, credential availability and an authorized API read; it does not certify a native AI client version |
| kintsugi mcp serve --profile NAME | Start a local stdio bridge; first use may open browser sign-in |

The executable returns stable JSON when requested, uses stdout for results and stderr for diagnostics, and does not prompt under `--no-input`. Export refuses to overwrite an existing file. A CLI can export text for a chat without tools; it cannot inject a prompt into an arbitrary running AI conversation. Linux uses `secret-tool` with Secret Service; see the [CLI reference](coding-agent-cli.md) for secure-store and private-CA requirements.

## MCP tools

The local server exposes these read-only tools when the matching backend capability is enabled:

| Tool | Required scope |
|---|---|
| project_list | Current installation and authenticated user |
| task_list | Explicit project and optional stable-user/readiness filters |
| task_brief | Explicit project, full unit identity and requested activity |
| document_get | Explicit project, snapshot ID, registered source ID and section |
| document_search | Explicit project and snapshot ID with a bounded query |
| review_get | Explicit project and authorized review ID; advertised when the review capability is enabled |
| task_status | Explicit project and full unit identity |

The current CLI bridge advertises seven tools: `project_list`, `task_list`, `task_brief`, `document_get`, `document_search`, `review_get` and `task_status`. Document retrieval and search require the snapshot returned by `task_brief`; each tool call supplies its project/task selectors, and the bridge keeps no implicit active project or task. Tools do not edit tasks, documents, or repositories; `task_brief` creates a temporary context snapshot retained for 24 hours. Read-only annotations communicate intent but never replace server authorization. The CLI reads its OS credential store before each API request, allowing server-side Project Access revocation to take effect on the next call. Disposable-profile native lifecycle probes cover Claude Code 2.1.278 and Codex CLI 0.163.0-alpha.10.2; neither probe yet proves a live authenticated MCP tool call. Copilot setup is disabled pending a native version probe.

CLI JSON, MCP structured results and cited text use the same validated DTOs. MCP returns both structured data and equivalent JSON text, with stable safe error codes; it does not wrap JSON-RPC in REST response envelopes. Its stdin/stdout carry only protocol messages.

## Task context and readiness

The unit state and task document in the project document repository are authoritative. A brief resolves the full project/application/module/unit identity, assignment, objective, acceptance criteria, required deliverables, referenced basic and detailed designs, applicable standards and relevant gate evidence.

The application TO-BE design is a basic-design candidate; the unit design is a detailed-design candidate. Explicit references and shared document-layout helpers determine which sources actually apply. Every source reports availability separately from approval. An auto-committed task or a pending gate scaffold does not approve itself. A design task can be ready to produce the detailed design it lacks; implementation reports a blocker when required design or predecessor approval is missing.

A brief returns an immutable snapshot ID and an index of mandatory sections. Each repository is pinned to its own full Git commit. Source paths, content hashes, approval records, required deliverables and policy version are part of the manifest. Follow-up get/search calls return the same revisions and exact path citations. If content is too large for the brief, the result is explicitly partial and names the sections the AI must retrieve before coding. An expired or unavailable snapshot does not silently switch to the latest branch head ([ADR-0061](../decisions/0061-coding-agent-context-and-project-access.md)).

The browser-authorized connection is scoped to the consented project. Current user, `member.read`, and Project Access are checked on every call, even for an existing snapshot. New Project Access grants do not expand an existing connection. Administrators can choose a 15- or 30-day maximum connection age, which is checked on refresh; members can revoke their own connections and administrators with `security.manage` can revoke any connection. Existing legacy tokens remain bounded by their original expiry and revocation state. Task assignment filters use a stable user identity, not a display-name match. Reading or listing tasks never claims, assigns, approves or changes their status.

## PR and gate continuation

The developer works in the normal code and document repositories and opens ordinary pull requests. GitHub.com is the first provider. GitHub Enterprise Server requires an exact tested server version. Other providers, including GitLab, Bitbucket, Azure DevOps and AWS-hosted Git services, need later provider adapters.

Kintsugi receives signed provider notifications when configured and reconciles current PR state on a durable polling schedule. Reconciliation finds changes that arrived while the installation was offline. Each review binds the PR head and base, context snapshot, policy version and reviewer version. Incomplete inputs produce an inconclusive result. New relevant changes make old findings stale. The AI can fetch current cited findings through the CLI or MCP while the developer is online.

Provider-required checks and human PR reviews apply before code or document deliverables merge. The effective unit gate is a later phase-exit decision covering exact merged revisions. An authorized human decision is published as a readable gate-record PR; the gate is effective only after that record merges and validates against every required deliverable. A failed Git publication, changed evidence or duplicate event cannot silently advance the workflow. After validation, Kintsugi records the transition once and makes it visible through the portal and resumable SSE ([ADR-0062](../decisions/0062-evidence-bound-pr-continuation.md)).

The initial workflow does not let the member AI claim or approve tasks, write gate decisions, merge code PRs or administer Kintsugi. Remote MCP/OAuth, Kintsugi-owned chat, semantic search, telemetry hooks and additional Git providers are later work.
