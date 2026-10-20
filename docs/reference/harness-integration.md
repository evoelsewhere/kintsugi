# Harness integration

Status: T00–T06 implement the unreleased context API and shared SDK. The CLI, local MCP bridge and PR continuation remain planned. API and SDK changes must ship together; their strict version-1 schemas are still being finalized before release.

Kintsugi gives context to the developer's chosen AI. The AI reads the task, design, standards and evidence documents, then answers the developer with citations. Kintsugi does not need to run its own conversational model. The Coding Agent Workflow plugin is separate from project method plugins such as modernization content ([ADR-0041](../decisions/0041-coding-agent-workflow-through-cli-and-local-mcp.md)).

## Connection path

The developer installs the Kintsugi CLI and signs in to a self-hosted installation over HTTPS. The CLI starts a local stdio MCP process when a client asks for tools. The process has no inbound listener, shares the CLI's project-scoped credentials and calls the same typed Coding Agent Context API. A CLI-only path remains available for shells and explicit Markdown export.

Claude Code is the first complete client pilot. Codex and GitHub Copilot CLI are distinct targets; support is claimed only after each exact client version passes authentication, setup, protocol, upgrade and removal checks. See the [compatibility record](coding-agent-workflow-compatibility.md).

The Coding Agent Workflow plugin contains a small skill and client-specific MCP configuration. It has no hooks and does not edit arbitrary project instructions. Optional method plugins stay in the project document repository and are installed separately. Client-side instructions help the AI retrieve information; the server enforces authorization.

## Implemented context API

All routes below use Kintsugi's normal response envelope and require the catalog permission `member.read`, explicit token scope metadata and current Project Access. A session alone does not bypass project checks. Project listing intersects the token's project IDs with the user's current grants.

| GET path under `/api/member/v1` | Result |
|---|---|
| `/projects` | Authorized projects with a stable cursor |
| `/tasks?projectId=…` | Validated Git tasks; optional `mine`, `readyFor`, `limit` and `cursor` |
| `/task-brief?projectId=…&unitId=…&activity=…` | Bounded, cited context and immutable snapshot handle |
| `/documents?projectId=…&unitId=…&snapshotId=…&sourceId=…` | One registered source/section at the snapshot revision |
| `/search?projectId=…&unitId=…&snapshotId=…&query=…` | Bounded keyword matches with citations |
| `/task-status?projectId=…&unitId=…` | Work-item status, next action and observation availability |
| `/reviews/:reviewId?projectId=…` | HTTP 501 with `details.code: UNSUPPORTED_CAPABILITY` until review ingestion exists |

Use the full `application/module/unit` identity in `unitId`, encoded as a query value. Documents accept registered source IDs rather than arbitrary paths or URLs. Read tokens cannot issue tokens, change Project Access, claim tasks or call legacy session routes.

`TaskStatus.evidenceAvailability` reports `pullRequests` and `reviews` as `unavailable` in this preview. Empty arrays do not establish that no PR or review exists. Unknown gate publication remains `unknown`; source approval is fail-closed until trustworthy evidence readers exist.

Snapshot failures put a stable code and `snapshotId` in the error envelope's `details`:

| Code | HTTP status | Recovery |
|---|---|---|
| `SNAPSHOT_PREPARING` | 409 | Wait at least `retryAfterMs`, then retry the brief with the returned `snapshotId` |
| `SNAPSHOT_EXPIRED` | 410 | Request a new brief without the old handle |
| `SNAPSHOT_UNAVAILABLE` | 409 | Request a new brief; if retention continues to fail, check worker/mirror health |

Every retry rechecks authorization. A valid historical snapshot remains readable when newer context is invalid or oversized; its freshness is reported as stale when currentness cannot be established.

## Planned CLI contract

The initial commands are read-only except for local sign-in, profile selection, explicit file export and client setup.

| Command | Purpose |
|---|---|
| kintsugi auth login --url URL | Sign in to one installation; secret input is hidden and kept in the OS credential store |
| kintsugi auth status | Show the selected profile and connection status without showing a token |
| kintsugi project list / use ID | List authorized projects and select a local default |
| kintsugi task list --mine | List tasks assigned to the authenticated stable user identity |
| kintsugi task list --ready-for implementation | List tasks whose current inputs allow the requested activity |
| kintsugi task brief UNIT | Print the task, readiness blockers, required context index and citations |
| kintsugi task brief UNIT --format markdown --output FILE | Explicitly export a private, source-referenced brief |
| kintsugi document get --snapshot ID --source ID --section ID | Fetch a cited document section from the pinned snapshot |
| kintsugi document search --snapshot ID --query TEXT | Bounded keyword search inside the pinned context |
| kintsugi review list --task UNIT / review get ID | Find current authorized review references and retrieve actionable findings |
| kintsugi task status UNIT | Read current task and relevant PR/gate state |
| kintsugi task watch UNIT | Stream authorized workflow progress over resumable SSE |
| kintsugi plugins setup --harness claude-code | Install or update the access package for one tested client |
| kintsugi doctor | Check local installation, credential store, network and client capabilities |
| kintsugi mcp serve --profile NAME | Run the local stdio MCP bridge for the selected profile |

The executable returns stable JSON when requested, uses stdout for results and stderr for diagnostics. Noninteractive mode does not prompt. Export refuses to overwrite an existing file unless the user explicitly requests it. A CLI can export text for a chat without tools; it cannot inject a prompt into an arbitrary running AI conversation.

## MCP tools

The local server exposes these read-only tools when the matching backend capability is enabled:

| Tool | Required scope |
|---|---|
| project_list | Current installation and authenticated user |
| task_list | Explicit project and optional stable-user/readiness filters |
| task_brief | Explicit project, full unit identity and requested activity |
| document_get | Explicit project, snapshot ID, registered source ID and section |
| document_search | Explicit project and snapshot ID with a bounded query |
| review_get | Explicit project and authorized review ID |
| task_status | Explicit project and full unit identity |

Document retrieval calls require the snapshot returned by task_brief. The bridge does not keep an implicit active project or task. If review capability is unavailable, review_get is not advertised. Read-only annotations communicate intent but never replace server authorization.

CLI JSON, MCP structured results and cited text use the same validated DTOs. REST keeps Kintsugi's standard response envelope; MCP uses the protocol's native tool results and errors.

## Task context and readiness

The unit state and task document in the project document repository are authoritative. A brief resolves the full project/application/module/unit identity, assignment, objective, acceptance criteria, required deliverables, referenced basic and detailed designs, applicable standards and relevant gate evidence.

The application TO-BE design is a basic-design candidate; the unit design is a detailed-design candidate. Explicit references and shared document-layout helpers determine which sources actually apply. Every source reports availability separately from approval. An auto-committed task or a pending gate scaffold does not approve itself. A design task can be ready to produce the detailed design it lacks; implementation reports a blocker when required design or predecessor approval is missing.

A brief returns an immutable snapshot ID and an index of mandatory sections. Each repository is pinned to its own full Git commit. Source paths, content hashes, approval records, required deliverables and policy version are part of the manifest. Follow-up get/search calls return the same revisions and exact path citations. If content is too large for the brief, the result is explicitly partial and names the sections the AI must retrieve before coding. An expired or unavailable snapshot does not silently switch to the latest branch head ([ADR-0042](../decisions/0042-coding-agent-context-and-project-access.md)).

The member token is project-scoped. Current user and project authorization are checked on every call, even for an existing snapshot. Task assignment filters use a stable user identity, not a display-name match. Reading or listing tasks never claims, assigns, approves or changes their status.

## PR and gate continuation

The developer works in the normal code and document repositories and opens ordinary pull requests. GitHub.com is the first provider. GitHub Enterprise Server requires an exact tested server version. Other providers, including GitLab, Bitbucket, Azure DevOps and AWS-hosted Git services, need later provider adapters.

Kintsugi receives signed provider notifications when configured and reconciles current PR state on a durable polling schedule. Reconciliation finds changes that arrived while the installation was offline. Each review binds the PR head and base, context snapshot, policy version and reviewer version. Incomplete inputs produce an inconclusive result. New relevant changes make old findings stale. The AI can fetch current cited findings through the CLI or MCP while the developer is online.

Provider-required checks and human PR reviews apply before code or document deliverables merge. The effective unit gate is a later phase-exit decision covering exact merged revisions. An authorized human decision is published as a readable gate-record PR; the gate is effective only after that record merges and validates against every required deliverable. A failed Git publication, changed evidence or duplicate event cannot silently advance the workflow. After validation, Kintsugi records the transition once and makes it visible through the portal and resumable SSE ([ADR-0043](../decisions/0043-evidence-bound-pr-continuation.md)).

The initial workflow does not let the member AI claim or approve tasks, write gate decisions, merge code PRs or administer Kintsugi. Remote MCP/OAuth, Kintsugi-owned chat, semantic search, telemetry hooks and additional Git providers are later work.
