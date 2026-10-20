# Kintsugi Member Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended for independently reviewed security/durability tasks) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes no deployment, publication or changes to a developer's installed clients by itself.

**Goal:** Let a developer's chosen AI retrieve a coherent task/design brief, answer cited questions, work locally and open normal PRs that Kintsugi reviews and advances through evidence-bound human gates.

**Architecture:** One authorized HTTPS member API serves a typed CLI client and a local stdio MCP adapter. Git owns tasks, design and gate evidence; Postgres holds access controls, immutable snapshot indexes, projections, inbox/outbox and review coordination. GitHub/GHE observation and a generic runtime review job feed an explicit post-merge quality-gate bridge.

**Tech Stack:** TypeScript/ESM, Node ≥22.19.0, pnpm 10.18.0, installed Turbo 2.11.7, NestJS 12, PostgreSQL, pg-boss 12.37.1, system Git, Vitest, Commander 15.0.0, `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1, and `@napi-rs/keyring` 2.0.0. Linux credential storage is explicitly pinned to Secret Service.

**Spec:** [approved design v2](../specs/2026-10-20-kintsugi-member-access-design.md).

**Testing:** [testing plan and case IDs](2026-10-20-kintsugi-member-access-testing.md). Product-task checkboxes remain unchecked until task completion is recorded in the plan ledger.

## Global Constraints

- Keep self-hosted Compose, Postgres, pg-boss and Git. No broker, extra datastore, new coding-agent runner or runtime-specific business logic.
- Read access first: tasks, basic/detailed designs, standards, evidence and review findings. No member-agent task claiming, assignment, approval or administration writes in v1.
- The developer's chosen AI answers questions. A Kintsugi-owned conversational assistant is later; server-side PR review remains part of the complete workflow.
- Support Claude Code, Codex and Copilot CLI as three distinct local client targets. Hosted/web agents and other IDE surfaces are later targets.
- Basic v1 excludes merge-queue repositories until `merge_group` input/check semantics are implemented and tested.
- Shared vocabulary lives in `packages/domain`; project responsibility/assignment does not grant access. No pi-specific code outside `services/runtime`; no new kernel tool is planned.
- API dependencies point inward; cross-module imports use public exports. Harness Hub cannot import API-private aliases or the API package.
- REST retains the existing response envelope. MCP stdout is protocol-only; normal CLI JSON and error streams are explicit.
- Runtime source/inputs are read-only; writes are output/scratch only. No member/provider credentials enter runtime job environments.
- New permission codes are inserted by migrations. Applied migrations and accepted ADR decisions are never rewritten in place.
- Preserve unrelated work. Execute from a clean isolated checkout based on the verified remote default branch, currently `origin/master`, after fetching. Reinspect before execution; do not assume `origin/main`.
- Planning is complete and implementation was authorized on 20 October 2026. Run the task-scoped tests and local builds required by this plan. External PR creation, package publication, installed-client setup outside disposable test profiles and deployment remain separate release actions.

## Review Focus

These five conditions require explicit tests in the owning tasks, not only the happy-path tests:

1. An administrator's read-only member token must not inherit write access through old API routes — T02, AUTH-05.
2. A second document call after HEAD changes must remain on the original snapshot, including after restart — T05/T08, CTX-02.
3. An oversized mandatory design cannot masquerade as a complete brief — T05/T07, CTX-05.
4. A PR opened and merged during downtime must be discovered without replayed webhooks — T11, PR-04.
5. A code check and the gate-record validator must not wait for the post-merge gate they enable — T14/T15, GATE-06.

## Delivery and dependency map

Use the ordered tasks as the implementation ledger. Steps within each task are sequential; prerequisites are explicit. Schema/API contracts settle before consumers. Review security and durability changes before later tasks depend on them.

| Milestone | Tasks | Reviewable result |
|---|---|---|
| M0 — Baseline and contracts | T00–T01 | ADR records, frozen query/evidence shapes and synthetic pilot fixture |
| M1 — Authorized reads | T02–T06 | Scoped member access, Git task projection, immutable context and API; approval-unknown content remains blocked for implementation |
| M2 — Developer access preview | T07–T09 | CLI, stdio MCP and small generated access plugin; cited Q&A and export |
| M3 — PR feedback | T10–T13 | Provider observations, complete review inputs, current findings and policy evaluation |
| M4 — Effective gates | T14–T16 | Verified Git gate publication, exactly-once effective advancement, SSE and portal workflow |
| M5 — Release evidence | T17 | Mandatory checks, native-client matrix and populated end-to-end pilot |

Read access and draft/design Q&A can preview before M4. Do not label a task implementation-ready in production by using fixture approval data; until its real approval evidence can be verified, return explicit blockers. Full workflow release requires M0–M5.

## Files and responsibilities

Paths are relative to the repository root. New modules follow domain/application/infrastructure/interface anatomy. Each task's file list names the owning files; package metadata, tsconfigs, tests and public exports belong to that deliverable. New migration numbers below start after observed `017_agent_write_tools.sql`; reallocate before execution if another branch has used a number, and update all references together.

| Owner | Files / responsibility |
|---|---|
| Domain | `packages/domain/src/member-task.ts`, `gate-evidence.ts`, existing `index.ts` / `document-layout.ts`: pure vocabulary, validation, readiness and paths |
| Contract | `packages/harness-sdk/src/member-access.ts`, `member-schemas.ts`, `index.ts`: queries/results and `MemberAccessPort` |
| Authentication | Existing core auth module plus `member-token.*`; new `admin/project-access/` module: token lifecycle and explicit project grants |
| Task/context API | New `delivery/member-access/`: Git-backed task/approval reads, snapshot indexing, bounded retrieval and controller |
| Durability | `services/orchestrator/src/outbox/`: shared transactional transition/outbox implementation, exported as `@kintsugi/orchestrator/outbox` |
| Client | New `packages/kintsugi-client/`: authenticated HTTPS and SSE only; no database/Git access |
| CLI | New `packages/cli/`: profile/OS credential adapter, commands, rendering and process entry |
| Harness Hub | New package metadata and `services/harness-hub/src/`: injected stdio transport and generated native packages |
| Provider | `packages/git/src/github-app.ts`, `pull-request-observer.ts`, `github-observer.ts`: credentials and GitHub/GHE facts, without Kintsugi workflow policy |
| Review/gates | New `delivery/member-reviews/`, `orchestrator/src/member-reviews/`, existing governance gates + new gate-publication adapter: fixed inputs, findings, effective decisions |
| Portal | Focused `member-task`, `member-access`, `member-tokens`, `gate-publication` components; existing project/gate surfaces compose them |
| Verification | Existing test support plus synthetic fixtures and new non-publishing CI workflow; no production service or user database |

## Frozen interfaces and planning defaults

T01 owns the exact exported DTO definitions; later tasks use these names. Dates are UTC ISO strings; Git object IDs are full SHA-1 or SHA-256 IDs validated by shared schemas. All wire shapes have `schemaVersion: "1"`. Query unit IDs travel as query values, never path fragments that split `<app>/<module>/<unit>`.

`MemberAccessPort` has eight methods (seven MCP tools plus the CLI-only event stream):

```ts
listProjects(query: ProjectQuery): Promise<ListResult<ProjectSummary>>;
listTasks(query: TaskQuery): Promise<ListResult<TaskSummary>>;
briefTask(query: TaskBriefQuery): Promise<TaskBrief>;
getDocument(query: DocumentQuery): Promise<DocumentPage>;
searchDocuments(query: DocumentSearchQuery): Promise<ListResult<SourceHit>>;
getReview(query: ReviewQuery): Promise<ReviewReport>;
taskStatus(query: TaskIdentity): Promise<TaskStatus>;
watchTask(query: TaskEventQuery, signal: AbortSignal): AsyncIterable<TaskEvent>;
```

- `TaskIdentity = {projectId, unitId}`. `TaskQuery` adds `mine?`, `readyFor?`, `limit`, `cursor?`; `TaskBriefQuery` adds `activity: "design" | "implementation" | "verification"`, optional `snapshotId` and `maxBytes`.
- `TaskBrief` includes task/objective/acceptance criteria, `snapshotId`, `contextRevision`, full source manifest, required deliverable IDs, source approvals, readiness/blockers, `requiredContextStatus`, `omittedSections`, optional continuation, currentness and fetch time. It extends the existing `TaskPack` semantics instead of replacing them.
- `DocumentQuery = {projectId, snapshotId, sourceId, sectionId?, cursor?, maxBytes}`; search requires the same snapshot plus `query`, `limit`, `cursor?`. No arbitrary URL/path fetch.
- `DocumentPage` includes source/commit/hash, text with line/range citations, `complete`, `requiredSectionsRemaining` and optional cursor. `ListResult<T> = {items, limit, nextCursor?}`; adapters reuse existing API pagination utilities where applicable.
- `ReviewReport` contains identity, generation, reviewed head/base/merge-base/context/policy/agent revisions, coverage, verdict and findings with stable IDs/severity/location/rationale/currentness. `ReviewQuery = {projectId, reviewId}`.
- `TaskStatus` includes relevant PRs, current review IDs, effective gate/publication state and next action; capability flags keep unavailable review features explicit during the preview.
- `TaskEvent` includes project-local ordered `id`, project/unit, event kind and bounded metadata, never source content/secrets. Resume is project-scoped.
- Proposed defaults to freeze in T00: brief/page maximum 32 KiB (caller may request less); list maximum 100; search query maximum 500 characters; member token lifetime 30 days; snapshot expiry 24 hours; SSE replay 7 days. Active reviews retain input pins until terminal state plus 30 days; merged gate evidence pins are not automatically pruned. These defaults are implementation choices, not research benchmarks.
- Failure details use stable codes inside the existing error envelope: `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONTEXT_CHANGED`, `SNAPSHOT_PREPARING`, `SNAPSHOT_EXPIRED`, `SNAPSHOT_UNAVAILABLE`, `INCOMPLETE_INPUT`, `UNSUPPORTED_CAPABILITY`, `RATE_LIMITED`. No silently substituted HEAD or local cache.
- Read-only MCP tools are `project_list`, `task_list`, `task_brief`, `document_get`, `document_search`, `review_get`, `task_status`; advertise review tools only when their real backend capability is enabled.

### Task 0 (T00) — Record the approved decisions and reproducible pilot baseline

**Depends on:** approved spec. **Files:** create ADRs `0041-member-access-through-cli-and-local-mcp.md`, `0042-member-context-and-project-access.md`, `0043-evidence-bound-pr-continuation.md`; amend the decision register (D17–D19, D43, D54) and affected harness/identity references; create `docs/reference/member-access-compatibility.md`, `test/fixtures/member-access/README.md` and synthetic project/revision/variant documents. Use new register rows D57–D59 for approved access, snapshot and gate decisions. Do not rewrite accepted ADR decisions; link amendments/supersession precisely.

**Interfaces:** consumes existing ADRs and package manifests; produces the version/capability matrix, fixture IDs and named policies used throughout T01–T17. Fixture: project `modernization`, application `billing`, unit `billing/invoices/tax`, users `reader-a`, `reader-b`, `maintainer`, docs `project-docs`, target `billing-api`, required deliverables `code` and `design`.

- [x] Record host Node 24.21.0, Corepack pnpm 10.18.0, Git 2.45.1, installed Turbo 2.11.7 and OS. Claude Code 2.1.278 and Codex 0.163.0-alpha.10.2 were observed; Copilot CLI is absent, and none of these probes establishes native compatibility. Resolve Turbo and read its bundled docs before changing commands/config. Freeze exact boundary dependencies Commander 15.0.0 (ESM, Node >=22.12), MCP server/client 2.3.1 (same fixed release group; server v2.3.1 supports legacy and modern eras through `serveStdio`), and `@napi-rs/keyring` 2.0.0 (official Node-API/Rust package); on Linux require Secret Service so unavailable persistent storage fails closed instead of falling back to the ephemeral kernel keyring. Sources: https://github.com/tj/commander.js/releases/tag/v15.0.0; https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.1; https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md; https://github.com/Brooooooklyn/keyring-node; https://www.npmjs.com/package/%40napi-rs/keyring. Keep exact versions and lockfile entries; no floating ranges for these boundary dependencies.
- [x] Write the three ADR records and compatibility table. Explicitly amend accepted plugin/harness decisions: the dedicated hookless access plugin is separate from `modernize`, the installed CLI launches local MCP, and remote MCP/OAuth is deferred. Update D17–D19, D43 and D54; add D57–D59. GitHub.com is the reference pilot; an exact GHE version remains unsupported until probed. Record private workspace names separately from the still-unverified public package namespace; verify public ownership only before publication.
- [x] Prepare synthetic unit/task/basic/detail-design/standards/gate fixtures and two revisions A/B. Include draft/pending/missing/injection/large-design variants. No real source, credentials or customer material.
- [x] Review the fixture against design sections 5–6 and testing cases CTX-01/03. Expected: one full unit identity, explicit required deliverables, exact source roles and independent approval fixtures; missing approvals do not become implementation-ready.
- [x] Commit the approved design, plans, ADRs, affected references and fixtures with the message docs(member-access): record contracts and pilot baseline.

### Task 1 (T01) — Shared validation, readiness and member-access contract

**Depends on:** T00. **Files:** create domain `member-task.ts`, `gate-evidence.ts`, tests `member-task.test.ts`, `gate-evidence.test.ts`; create SDK `member-access.ts`, `member-schemas.ts`, `test/member-schemas.test.ts`; update their `index.ts`, SDK package/test configuration and tsconfigs.

**Interfaces:** consumes `WorkItemFile`, existing Phase/ProjectRole/MemberHarnessId/path helpers. Produces the frozen DTOs above; `parseWorkItemFile(value: unknown): ValidationResult<WorkItemFile>`, `evaluateReadiness(input: TaskReadinessInput): ReadinessResult`, `validateGateEvidence(value: unknown): ValidationResult<GateEvidence>`. `ValidationResult<T>` is `{ok:true,value:T} | {ok:false,issues:ValidationProblem[]}`, reusing existing validation problem types.

- [x] Add failing tests: `rejectsShortOrForeignUnitId`, `draftDesignTaskDoesNotRequireItsOutput`, `pendingGateDoesNotApprovePublishedTask`, `wireSchemasRejectUnknownSelectors`. Assertion examples: `expect(evaluateReadiness(designFixture).readyFor).toContain("design")`; `expect(evaluateReadiness(pendingFixture).readyFor).not.toContain("implementation")`. Fixture factories/data live with these tests and are exported only through test support.
- [x] Run `pnpm --filter @kintsugi/domain exec vitest run test/member-task.test.ts test/gate-evidence.test.ts`; run the new SDK suite after its test script is present. Expected initial failure is the named missing behavior/export, not an unrelated dependency failure.
- [x] Implement pure validation/readiness and the seven query/result schemas. Gate evidence includes decision/audit identity, policy/context, deliverable IDs, PR/repo IDs and reviewed/merged revisions; actor names alone do not validate authority. Keep YAML, SQL and HTTP out of domain.
- [x] Add a compile-time port implementation fixture proving all eight method signatures and discriminated results; add schema limits/defaults and partial-context tests. Do not add a runtime use case to the generic runtime.
- [x] Run both package tests/typechecks, then commit `feat(member-access): define shared query and evidence contracts`.

### Task 2 (T02) — Scoped tokens and project access, including old-route denial

**Depends on:** T01. **Files:** create migration `018_member_access.sql`; core auth `domain/member-token.repository.ts`, `application/member-token.service.ts`, `infrastructure/pg-member-token.repository.ts`, `interface/member-tokens.controller.ts`; new `admin/project-access/` feature and public `index.ts`; modify auth guard/module/decorators, app composition and API tests `integration/member-auth.test.ts`, `integration/project-access.test.ts`.

**Interfaces:** `MemberTokenService.issue(actor, {name, projectIds, expiresAt}): Promise<{token:string; metadata:TokenMetadata}>`, `revoke(actor, tokenId): Promise<void>`, `authenticateMemberToken(token): Promise<MemberPrincipal | undefined>`; `ProjectAccessService.requireRead(userId, projectId): Promise<void>`. `MemberPrincipal` carries immutable user/token IDs and a restricted credential kind; it is created server-side, never accepted from wire data.

- [ ] Write AUTH-01–08 tests. Critical assertion: an admin-owned member token gets 403 on `POST /api/admin/roles`, `POST /api/governance/gates` and every unmarked legacy read route, despite the owner's installation permissions. A normal cookie session retains current behavior. Test source/data markers never appear in denied responses.
- [ ] Run `pnpm --filter @kintsugi/api exec vitest run test/integration/member-auth.test.ts test/integration/project-access.test.ts` with the isolated test database configured. Expect the restricted-token behavior to fail before implementation; skip is not proof.
- [ ] Add `core.member_token`, its project allowlist and `admin.project_access` with FKs and fully qualified names. Insert catalog codes `member.read`, `tokens.manage-own`, `project.access.manage`; seed only the intended admin management permissions and explicit pilot grants. RACI/assignee values grant nothing.
- [ ] Implement random token issuance, hash-only storage, expiry/revocation/current-user checks and safe listing. Extend the global guard so member tokens require explicit route-scope metadata and intersect token scope, current user permission and project access. Never let a PAT inherit session-wide authority on legacy routes.
- [ ] Add cookie-authenticated own-token/grant management endpoints (issuance returns the secret once; lists never do). Run auth/identity regressions and typecheck; commit `feat(auth): add project-scoped member read tokens`.

### Task 3 (T03) — Shared durable transitions, event ordering and outbox

**Depends on:** T01. **Files:** create migration `019_member_outbox.sql`; orchestrator `src/outbox/model.ts`, `store.ts`, `dispatch.ts`, `test/outbox.test.ts`; export `@kintsugi/orchestrator/outbox` through package metadata; reuse API `common/db/pool.ts` transaction wrapper at API call sites.

**Interfaces:** `recordTransition(tx: PoolClient, change: TransitionInput, apply: (tx: PoolClient) => Promise<void>): Promise<TransitionReceipt>`; `dispatchOutbox(deps: OutboxDeps, signal: AbortSignal): Promise<DispatchSummary>`. Input owns stable transition key, project/unit, optional member event and queue intents. Publisher receives stable `operationId`; duplicate delivery is expected.

- [ ] Write EVT-01–03 tests: rollback leaves no projection/event/intent; duplicate concurrent transitions invoke `apply` once; crash after publish but before acknowledgment safely replays the same operation ID. Assert `projectionWrites === 1` and one effective next-step operation.
- [ ] Run `pnpm --filter @kintsugi/orchestrator exec vitest run test/outbox.test.ts`; verify real Postgres execution, initially failing on missing transitions.
- [ ] Implement `workflow.member_transition`, `member_event`, project event cursor and `outbox`. Allocate per-project event sequence under the project cursor row lock in the same transaction, so a later committed event cannot cause replay to skip an earlier still-uncommitted event. Domain projections remain reconstructible from Git.
- [ ] Implement leasing/retry/backoff and idempotent operation IDs; no external Git/provider call inside the projection transaction. Snapshot retention and later review/gate intents all reuse this implementation, never per-feature queue boilerplate. Verify installed pg-boss API only at its publishing adapter.
- [ ] Run rollback/concurrent-publisher tests and typecheck; commit `feat(workflow): add durable member transitions and outbox`.

### Task 4 (T04) — Authoritative Git task and assignment projection

**Depends on:** T01–T02. **Files:** create migration `020_member_tasks.sql`; domain validation from T01; agents `src/unit-document.ts` plus shared frontmatter helper as required, `test/unit-document.test.ts`; new API `delivery/member-access/domain/{task,member-access.ports}.ts`, `application/task-query.service.ts`, `infrastructure/git-task.reader.ts`, `pg-task-projection.ts`, module/public exports; tests `unit/task-readiness.test.ts`, `integration/member-tasks.test.ts`.

**Interfaces:** `parseUnitDocument(markdown: string): ValidationResult<WorkItemFile>`; `TaskQueryService.list(principal, query: TaskQuery): Promise<ListResult<TaskSummary>>`; `get(principal, id: TaskIdentity): Promise<TaskRecord>`. `TaskRecord` includes the authoritative Git location and explicit input/output references; `ApprovalEvidenceReader` returns verified, pending or unknown evidence, never a guessed boolean.

- [ ] Write CTX-01/03 and AUTH-06 tests: actor matches stable assignee ID, malformed/mismatched files are rejected, draft-design tasks can proceed, implementation is blocked by missing required approval, and another project's unit cannot be listed. A task on main with a pending scaffold stays unapproved.
- [ ] Run agents unit parsing and API member-task tests; verify expected failing assertions before implementation.
- [ ] Reuse the existing YAML dependency/frontmatter utilities for a strict authoritative parser and domain validator. Keep the current tolerant `@kintsugi/agents/reader` view behavior for compatibility; never use its truncated summary as authorization or task authority. Reuse domain layout helpers for unit/task/design paths.
- [ ] Persist `delivery.member_task_projection` keyed by project/full unit and source commit, rebuilding on document sync. Surface missing mirror/stale index explicitly. Normalize legacy assignee names through an explicit identity lookup; unknown/ambiguous assignees stay unresolved. Until T14 can verify real quality-gate evidence, unknown approvals block live implementation readiness; synthetic approved fixtures are test-only.
- [ ] Run parser, readiness, assignment and existing document-result regressions; commit `feat(delivery): project member tasks from Git unit files`.

### Task 5 (T05) — Immutable snapshots, bounded retrieval and worker-owned pins

**Depends on:** T03–T04. **Files:** create migration `021_member_snapshots.sql`; API member-access `application/{snapshot,document-query}.service.ts`, infrastructure `pg-snapshot.repository.ts`, domain `snapshot.ts`; worker `git-sync/retention.ts`, `test/snapshot-retention.test.ts`; tests `integration/member-context.test.ts`, `unit/context-manifest.test.ts`.

**Interfaces:** `SnapshotService.brief(principal, query: TaskBriefQuery): Promise<TaskBrief>`; `DocumentQueryService.get(principal, query: DocumentQuery): Promise<DocumentPage>` and `search(principal, query: DocumentSearchQuery): Promise<ListResult<SourceHit>>`; worker `retainSnapshot(deps, snapshotId): Promise<RetentionResult>`. Manifest hash canonicalizes relevant input identity/content/policy, not generated output or observation timestamps.

- [ ] Write CTX-02/04–10 tests. Given brief A, commit/push B, restart API, then fetch/search with A: `expect(page.commit).toBe(commitA)`. Set a mandatory section above 32 KiB and assert `requiredContextStatus === "partial"`, a continuation and exact remaining section IDs. Relevant input B changes the manifest hash; generated-only C does not. Restricted selectors/injection cannot expand reads; revocation blocks existing handles.
- [ ] Run API context/manifest tests and worker retention tests; verify real Git fixtures rather than only mocked strings.
- [ ] Store the immutable manifest and source index in `delivery.member_snapshot`/`member_snapshot_source`; no content duplication or new semantic index. Reuse registered document readers via public ports. API data mounts stay read-only: request retention through the shared outbox; the worker creates local `refs/kintsugi/snapshots/<id>` pins under its mirror lock before marking the snapshot ready.
- [ ] Return `SNAPSHOT_PREPARING` until required pins exist; clients may retry safe preparation for at most 30 seconds. Implement 24-hour expiry, bounded section/cursor reads and keyword search within the same manifest. Reject foreign source IDs, cursor tampering, arbitrary links, `.git` and restricted paths. An unavailable historical object returns an explicit failure, never HEAD.
- [ ] Verify cleanup removes only expired, unreferenced local pins; active reviews and merged evidence retain leases. Test that unrelated generated commits do not change context revision. Run relevant suites and commit `feat(context): add pinned member snapshots and paged sources`.

### Task 6 (T06) — Versioned member API and complete preview capability contract

**Depends on:** T02/T04/T05. **Files:** member-access `interface/member-access.controller.ts`, `member-access.dto.ts`, `application/member-access.service.ts`, `domain/review-reader.port.ts`, module; SDK exports; API app composition and `test/integration/member-api.test.ts`, `test/unit/member-api-contract.test.ts`.

**Interfaces:** HTTPS routes under `/api/member/v1`: GET `/projects`, `/tasks`, `/task-brief`, `/documents`, `/search`, `/task-status`; GET `/reviews/:reviewId` becomes available when T13 supplies `ReviewReader`. All data routes explicitly require catalog `member.read`, member-token scope metadata and project access. `MemberAccessService` implements the seven nonstream methods of the port using authorized feature services, not transport code.

- [ ] Write contract tests for envelope, valid queries, 400 schema errors, 401/403, explicit unavailable reviews, slash-containing unit query values and matching CLI/MCP-ready payloads. Test that source URLs do not become server-side fetch requests.
- [ ] Run `pnpm --filter @kintsugi/api exec vitest run test/integration/member-api.test.ts test/unit/member-api-contract.test.ts`.
- [ ] Wire plain-returning controllers and shared validators; preserve the global response interceptor. Export feature services through `index.ts`. Do not expose server MCP or change SPA fallback in this milestone. Represent absent review capability explicitly, with no passing stub report.
- [ ] Exercise one prepared draft/design brief through real HTTP and ensure missing quality approval is shown as a blocker; keep API methods and schema error codes stable.
- [ ] Run auth/context regressions and API typecheck/lint; commit `feat(api): expose versioned member query endpoints`.

### Task 7 (T07) — Typed HTTPS client, secure CLI and coherent export

**Depends on:** T06. **Files:** new `packages/kintsugi-client/{package.json,tsconfig.json,src/client.ts,src/errors.ts,test/client.test.ts}`; new `packages/cli/` (`@kintsugi/cli`) with exact Commander/keyring dependencies and `src/{main,cli,profile,credential-store,render}.ts`, `src/commands/{auth,project,task,document,doctor}.ts`, `test/{cli,credential-store,export}.test.ts` and package/test configs. Reuse SDK types rather than API-private imports.

**Interfaces:** `createMemberClient({baseUrl, tokenProvider, fetch, signal?}): MemberAccessPort`; `runCli(argv: readonly string[], deps: CliDeps): Promise<number>`; `CredentialStore.get/set/delete(profileId)`; `writeBrief(path, brief, {overwrite:false}): Promise<void>`. IO/clock/credential/fetch dependencies are injected; the entrypoint alone sets process exit status.

Workspace package names are `@kintsugi/kintsugi-client` and `@kintsugi/cli`; the executable is `kintsugi`. `review list --task` renders the authorized review references from `taskStatus`; it does not introduce an eighth MCP query or a second review-list API. The CLI `--format` values are `text | json | markdown`, with `--json` as the JSON alias; `task brief` passes an explicit activity (default `implementation`) and prints blockers without claiming that a blocked task is ready.

- [ ] Write CLI-01–08 tests. Assert parseable JSON stdout, JSON error stderr with empty stdout, no prompt under `--no-input`, no secret in logs/profile/argv, explicit installation mismatch rejection, local export refusal on existing file and mandatory omissions preserved.
- [ ] Run the two new package suites against an HTTP fixture; build dependent packages first through the documented Turbo graph. Confirm failures identify the missing behavior.
- [ ] Implement fixed commands from design section 7; use the T00-pinned Commander and OS credential library. Prompt hidden or read token from stdin; store only the nonsecret URL/profile/project in config. A missing/unavailable secure store fails rather than writing plaintext; an explicit one-shot CI token is not persisted. Validate HTTPS/origin, reject cross-origin redirects carrying credentials and support registered private CA without disabling TLS.
- [ ] Implement typed envelope/schema/version checks, bounded safe-read retries/Retry-After, cancellation and the 30-second snapshot preparation bound. Markdown export is deterministic source-backed content, never model synthesis; emit restrictive permissions and show source revisions. The CLI cannot write/claim server tasks.
- [ ] Run compiled process tests on Node ≥22.19, not only `runCli` unit tests; commit `feat(cli): add secure task and design retrieval commands`.

### Task 8 (T08) — Local stdio MCP with explicit snapshot arguments

**Depends on:** T07. **Files:** create Harness Hub package/tsconfigs with exact `@modelcontextprotocol/server@2.3.1` dependency and test dependency `@modelcontextprotocol/client@2.3.1`; add `src/{index,member-mcp,tool-map}.ts`, `test/{stdio,tool-contract}.test.ts`; extend CLI `mcp` branch and exports; add SDK contract fixture.

**Interfaces:** `createMemberMcp(access: MemberAccessPort, capabilities: MemberCapabilities): McpServer`; `serveMemberStdio(deps: StdioDeps): Promise<void>`. Use `McpServer` and `registerTool` from `@modelcontextprotocol/server`; own connection lifecycle through `serveStdio(() => buildServer())` from its `/stdio` entry. Pin client and server to 2.3.1. SDK-specific code stays in Harness Hub; API never depends on it for business rules. CLI `kintsugi mcp serve --profile work` receives the same local credential profile. Exercise the installed clients protocol negotiation; SDK compatibility across the 2025 legacy and 2026-07-28 modern eras must be configured and tested through `serveStdio`.

- [ ] Write MCP-01–05 tests: initialize/list/call through the real pinned SDK client/server over a spawned stdio process, seven-tool names when enabled, read-only annotations, explicit project/snapshot/source inputs and structured plus textual results. Assert every stdout record is a protocol message and EOF releases resources.
- [ ] Run `pnpm --filter @kintsugi/harness-hub exec vitest run test/stdio.test.ts test/tool-contract.test.ts` and the CLI process bridge test; inspect initial failure.
- [ ] Implement injected adapter and error translation; do not wrap JSON-RPC in REST envelopes. Initially omit `review_get` if real review capability is absent. Reject missing snapshot selectors rather than remembering an active task in connection state. Never pass credentials to the model result.
- [ ] Test repeated sessions, malformed args, disabled capability, expired token and per-call authorization after revocation. Remote MCP/OAuth remains absent.
- [ ] Run SDK/client/CLI/Hub contract suites and typechecks; commit `feat(harness): expose local member MCP tools`.

### Task 9 (T09) — Small access skill and generated client packages

**Depends on:** T08. **Files:** canonical `packages/agents/builtin/plugins/access/.claude-plugin/plugin.json`, `kintsugi.json`, `skills/kintsugi-task/SKILL.md`, supporting references; Hub `src/plugins/{generate,setup,compatibility}.ts`, `test/plugins.test.ts`; CLI plugins command; plugin catalog/agents tests as needed.

**Interfaces:** `generateAccessPlugin(input: AccessPluginInput): GeneratedPluginFiles`; `planClientSetup(input: SetupInput): SetupChange[]`; `applyClientSetup(changes, deps): Promise<SetupReport>`. Generation inputs contain verified launcher path/profile/version, never a token. Use native target directories to avoid manifest precedence/duplicate MCP registrations.

- [ ] Write PKG-01–05 and MCP-06 tests: generated sources share one skill, no `modernize`/hooks/server-workflow dependency, exact launcher version/profile, idempotent repeat setup, unrelated settings preserved and incompatible client version rejected before mutation.
- [ ] Run Hub/agents/CLI packaging tests; validate generated Claude package with `claude plugin validate --strict <generated-path>` during native probes only, not against hand-maintained copies.
- [ ] Implement the skill's receive → read required sections → cite answers → expose unknowns → plan/work only as the user requested → PR references → read findings flow. Retrieved source text cannot authorize new commands, secret access or destinations. Do not treat a model's acknowledgment as a persisted gate.
- [ ] Generate Claude/Codex/Copilot target manifests/marketplaces from canonical content, respecting T00's exact tested versions. Use native install commands after explicit setup invocation, exact local artifact versions/commits and a reversible setup report. No floating npm execution, silent auto-enable or publication.
- [ ] Run fresh disposable-profile setup checks for each available native client, record absent clients as unverified, then commit `feat(plugins): generate lightweight member access packages`.

### Task 10 (T10) — GitHub/GHE observation and credential capability adapter

**Depends on:** T01/T03. **Files:** migration `022_member_provider.sql`; Git `src/{pull-request-observer,github-observer,github-app}.ts`, existing exports and tests `observer.test.ts`, `github-app.test.ts`; API/worker Git credential binding through existing public registry adapters; administrative connection DTO/service changes and tests.

**Interfaces:** `PullRequestObserver.capabilities(connection): Promise<ProviderCapabilities>`, `listChanged(connection, watermark, cursor?): Promise<ChangePage>`, `get(connection, identity): Promise<ObservedPullRequest>`; `GitHubInstallationCredentialProvider.resolve(connection, purpose): Promise<GitCredential>`. `ObservedPullRequest` uses stable host/repository/PR IDs plus head/base/merge-base/test-merge/final merge facts, checks and reviews; GitHub payload fields remain private to its adapter.

- [ ] Write PR-01/02 and REV-03 tests for public/GHE base URLs, installation-token refresh, requested repo/permission narrowing, redirect/host binding, redacted errors and distinct unsupported/unknown capabilities.
- [ ] Run `pnpm --filter @kintsugi/git exec vitest run test/observer.test.ts test/github-app.test.ts` with fake fetch and clock; require initial contract failure.
- [ ] Implement the read adapter and encrypted server-side App configuration, without per-developer Git tokens or runtime env credentials. Existing PAT observation is capability-tested, never assumed equivalent for Checks writes. Reject merge-queue pilot configuration explicitly.
- [ ] Persist stable provider actor mappings and maintainer-confirmed task associations as operational metadata; auto-link only when verified, otherwise expose an association-needed result. Contributor identity is not inferred from display names or a check event's PR array.
- [ ] Run existing PR creation/Git credential tests to preserve writer behavior; record actual GitHub/GHE probe evidence only in disposable repos; commit `feat(git): add GitHub pull request observation capabilities`.

### Task 11 (T11) — Durable webhook inbox and all-state reconciliation

**Depends on:** T03/T10. **Files:** worker `src/provider-sync/{inbox,reconcile,discover}.ts`, tests `provider-sync.test.ts`; API `delivery/member-reviews` webhook interface/module and domain association port; use T10 migration's inbox/observation/watermark tables; update worker queue wiring and existing Git-sync exports.

**Interfaces:** `acceptProviderDelivery(input: RawDelivery): Promise<Receipt>` validates before `persist`; `reconcilePullRequest(deps, identity): Promise<ReconcileResult>`; `discoverChanges(deps, connectionId): Promise<SweepResult>`. No head-sensitive verdict comes from webhook text alone.

- [ ] Write PR-03–08 tests: invalid signature persists nothing, duplicate delivery creates one receipt, out-of-order events fetch current state, and a PR opened+merged during downtime is discovered. Partial pagination must leave the durable watermark unchanged.
- [ ] Run API webhook and worker provider-sync suites. Explicitly test raw request bytes rather than reparsed JSON for signature validation.
- [ ] Register a signed provider webhook exception with raw-body handling, request limits and durable acknowledgment; it is not a normal user-token endpoint. Reuse inbox/outbox and per-PR serialization. Polling-only mode uses no inbound exposure.
- [ ] Implement state=all/updated reconciliation with overlap, pagination, deeper backfill, budget/jitter/backoff and credential degradation. Proposed defaults: 120-second normal sweep, 10-minute overlap, daily deeper scan; provider budget may lengthen cadence. Do not manufacture historical approvals when evidence is missing.
- [ ] Verify two workers, interrupted sweep, post-persist/pre-dispatch crash and reopened/edited associations; commit `feat(workflow): reconcile provider changes with durable recovery`.

### Task 12 (T12) — Complete fixed review inputs and versioned runtime job

**Depends on:** T05/T10/T11. **Files:** migration `023_member_reviews.sql`; worker `member-reviews/{inputs,schedule,store}.ts`, tests `review-inputs.test.ts`, `review-scheduling.test.ts`; canonical runtime plugin `packages/agents/builtin/plugins/review/` with `gate-reviewer.md` and output schema; agents catalog tests; existing generic job queue/store integration.

**Interfaces:** `materializeReviewInput(deps, observed: ObservedPullRequest, context: SnapshotManifest): Promise<ReviewInputManifest>`; `scheduleReview(deps, key: ReviewKey, generationReason): Promise<ReviewAttempt>`. Key binds immutable revisions/context/policy/agent version; generation records intentional reruns separately from duplicates.

- [ ] Write REV-01/02/04–07 tests: new push invalidates old completion, unchanged duplicate schedules once, authorized same-revision rerun creates the next generation, missing objects/API-cap truncation makes coverage incomplete and no passing report is published.
- [ ] Run worker review input/scheduling tests using the real local Git helper. A declared 3,001-file API response scenario must use Git enumeration or become inconclusive, never silently review 3,000 files.
- [ ] Fetch/verify immutable Git objects under worker credentials, enumerate complete changed inputs, and materialize only read-only job inputs. Record binaries/submodules/generated/excluded/missing/oversized coverage explicitly. Pin active inputs and exclude untrusted code execution.
- [ ] Supply a real versioned agent definition through the existing generic job contract, with bounded output validated against `ReviewReport`. No pi/use-case code in other services and no new runtime kernel tool. Preserve model-job retryLimit=0; distinguish safe fetch retries from audited new generations. Use scripted review output in automated tests; actual model semantics require the pilot.
- [ ] Confirm no credentials in job env/input/output, report validation rejects unsupported “pass” claims and stale generation results stay superseded; commit `feat(review): materialize fixed inputs and schedule revision-bound reviews`.

### Task 13 (T13) — Trusted evidence policy and actionable findings retrieval

**Depends on:** T06/T12. **Files:** domain `review-policy.ts` and tests; API `member-reviews/application/review-query.service.ts`, infrastructure `pg-review.reader.ts`, public exports and tests `integration/member-reviews.test.ts`; CLI review command, Hub capability map and their tests.

**Interfaces:** `evaluateReviewEvidence(input: ReviewEvidenceInput, policy: ReviewPolicy): EvidenceVerdict`; `ReviewQueryService.get(principal, query): Promise<ReviewReport>` implements the T06 `ReviewReader`. Policy defines context/check name, expected producer/App, evaluated revision, latest applicable attempt and required conclusions/review authority.

- [ ] Write REV-03/08–10 tests: wrong producer, skipped/neutral test evidence, dismissed/old human approval, stale revision and incomplete coverage cannot satisfy policy. Assertions name the unmet requirement rather than only `false`.
- [ ] Run domain policy, API findings and CLI/MCP contract tests; expect missing current findings capability before wiring.
- [ ] Implement immutable report/findings storage and current/superseded/inconclusive projection. Return stable finding IDs, severity, rationale, cited file/line, reviewed revision and repair guidance. Resolve final merged identity correctly for squash/rebase; unrelated later branch commits do not rewrite historical evidence.
- [ ] Enable real `review_get`, CLI `review get` and task-status review IDs. Optional GitHub publishing uses a separate capability/permission and SHA-bound output; absence never hides findings from the developer's AI.
- [ ] Exercise AI-independent repair retrieval against seeded findings, rerun auth/snapshot regressions, then commit `feat(review): expose trusted review evidence and current findings`.

### Task 14 (T14) — Evidence-bound human decision and Git gate publication

**Depends on:** T03/T10–T13. **Files:** migration `024_gate_publication.sql`; existing governance gates application/domain/infra plus `gate-publication` module/adapter; worker `gates/{publish,effective}.ts`; domain gate-evidence validator from T01; tests `integration/gate-publication.test.ts`, worker `gate-publication.test.ts`; update gate record reference/template and decision docs.

**Interfaces:** `GatePublicationService.requestDecision(actor, input: GateEvidence): Promise<GatePublication>`; `publishGate(deps, decisionId): Promise<PublicationResult>`; `verifyEffectiveGate(deps, record: GitLocation): Promise<EffectiveGateResult>`. `GatePublication` separates decision state from `awaiting-evidence | pending-publication | awaiting-merge | effective | stale | failed`.

- [ ] Write GATE-01–07 tests: DB approval alone does not advance, actor typed in Markdown is insufficient, head-A decision does not approve replacement B, failed writer stays pending, repeat publication reconciles one operation and gate PR cannot depend on its own effective gate.
- [ ] Run API/worker gate-publication tests with real document writer and a fake provider API. Expected failure must demonstrate the current DB-only behavior gap.
- [ ] Capture authenticated decision/audit proof over the exact completed evidence manifest. Code/document deliverable PRs merge after provider premerge approvals; then authorized G4 decision proposes a record with final merged revisions. Reuse writer `reviewAll: true`; gate paths never become auto-commit paths. Do not overwrite an accepted gate's old evidence in place without a new decision/version.
- [ ] Reconcile record merge through provider facts, not simple branch ancestry; validate schema, actor authority, current context/deliverable set and immutable merged evidence. Gate-record PR validation checks evidence/authority without waiting for that same G4. Confirm waiver scope, reason and authority explicitly; read tokens cannot request/decide/waive gates.
- [ ] Feed verified predecessor design approvals into T04's `ApprovalEvidenceReader` so real implementation readiness can become true. Run old gates/auth/writer regressions; commit `feat(governance): publish evidence-bound human gates through Git`.

### Task 15 (T15) — Effective continuation, durable events and CLI watch

**Depends on:** T03/T13/T14. **Files:** worker `member-workflow/{continue,project,dispatch}.ts`; API member status/event reader/controller; SDK/client SSE implementation; CLI watch; tests `continuation.test.ts`, `integration/member-events.test.ts`, client `events.test.ts`. For required procedural choices, create migration `025_stage_decisions.sql`, worker `jobs/persisted-gate-decider.ts`, `test/stage-decisions.test.ts`; modify existing job plan/model/executor/runner wiring and expose a session-authorized decision endpoint through the existing governance module.

**Interfaces:** `planContinuation(input: EffectiveGateFacts, taskPlan: ApprovedTaskPlan): WorkflowIntent[]`; `applyContinuation(deps, input): Promise<TransitionReceipt>`; `MemberEventReader.follow(principal, query: TaskEventQuery, signal): AsyncIterable<TaskEvent>`. `ApprovedTaskPlan` references existing manifest pipeline/task definitions, never model-invented next jobs.

`createPersistedGateDecider(deps: StageDecisionDeps): GateDecider` implements the existing worker port. Add explicit `decisionMode: "required-human" | "default"` to stage gate data/requests, classify current plans explicitly and persist `workflow.stage_decision` by job/run/gate identity with allowed options, selected choice and authenticated audit identity. Required choices wait for a validated decision and survive restart; optional defaults remain recorded. A procedural choice never supplies quality-gate evidence.

- [ ] Write EVT-01–05 and GATE-06/08–10 tests: exactly one effective transition/next operation under duplicates; failure between projection, event and intent rolls back; crash after external success reconciles safely; SSE reconnect never loses a committed earlier event. A required procedural choice neither defaults nor approves a delivery gate, resumes after restart with its authenticated choice, and rejects an invalid option/read token.
- [ ] Run worker continuation, API events and client stream tests, including an interrupted TCP stream and an expired cursor.
- [ ] In one DB transaction, use T03 to update operational projection, event and outbox intent after verified merged Git gate evidence. Unit state/reference changes go through the existing writer to Git. A later task becomes ready only from the resulting Git facts; no second DB phase state machine.
- [ ] For v1, the prepared pipeline's next member activity becomes visible (e.g. verification). Never invent a missing task or launch an unsupported `verify` runtime stage: current runnable stages are assess/understand/rebuild. Unsupported next actions remain explicit portal guidance. Wire the persisted decider into existing registered jobs; required human choices cannot fall through to `DEFAULT_GATE_DECIDER`. Reuse T03 for decision events/resume intent and the existing cancellation/replay contract; replay must retain the original actor rather than inventing `by: "resume"` authority.
- [ ] Add authorized task SSE/replay with seven-day retention, `Last-Event-ID`, resync error, heartbeat and stream reauthorization at each event plus idle intervals. CLI disconnect cancels its subscription only. Run crash/replay tests and commit `feat(workflow): advance effective gates and stream member events`.

### Task 16 (T16) — Portal token/access and task/gate handoff surfaces

**Depends on:** T02/T06/T13–T15. **Files:** create focused portal `pages/member-access/{member-task,member-tokens,gate-publication}.tsx`, `lib/api/member-access.ts`, tests beside components; compose into existing `pages/projects/project-detail-page.tsx`, `pages/governance-gates.tsx` and authenticated routes. Do not overwrite unrelated untracked onboarding/navigation work.

**Interfaces:** use T01 DTOs and existing `apiGet/apiPost` helpers, auth/permissions and SSE pattern. Access-token issue/revoke and project grants use cookie/session endpoints; task context and findings share backend use cases. No duplicated readiness or approval rules in React.

- [ ] Apply the UI Craft `/brief` step: focal next action, compact task/PR/evidence rows, compressed connection/sync health. Write UI-01–05 tests for read token issuance-once, draft/approved distinction, missing input blockers, “decision recorded / awaiting Git merge” and accessible cited findings.
- [ ] Run portal component/contract tests. Add a DOM test environment and React testing library only if not already present; pin/test-compatible dependencies as part of this task. Do not write tests that merely mirror rendering implementation.
- [ ] Implement resumable setup/status and “Work in my AI” instructions with correct harness command. No token in copyable commands, no auto-launch of coding agents, no approval bypass and no bulky integration dashboard.
- [ ] Test with populated fixtures and real keyboard interaction in the pilot; validate original design tokens and functional statuses, especially stale review and failed Git publication.
- [ ] Run portal typecheck/lint/tests plus targeted browser QA, then commit `feat(portal): expose member handoff and effective gate status`.

### Task 17 (T17) — Required CI, release matrix and full pilot evidence

**Depends on:** T00–T16. **Files:** create `.github/workflows/member-access-checks.yml`, `scripts/check-member-test-env.mjs`, `scripts/run-member-integration.mjs`, `scripts/assert-member-test-report.mjs`, `test/member-access/{pilot.test.ts,runner.test.mjs,vitest.config.ts,tsconfig.json}` and support; modify root `package.json`/lockfile and both existing API/worker `test/support/database.ts` helpers; testing plan evidence records; update `docs/guides/member-workflow.md`, harness reference and package release docs. Do not modify or trigger production deploy workflow during this task.

**Interfaces:** `node scripts/run-member-integration.mjs --suite api|worker|pilot|all` validates the explicit `KINTSUGI_TEST_DATABASE_URL`, then spawns the exact suites listed in the testing plan with child `DATABASE_URL` and `KINTSUGI_REQUIRED_INTEGRATION=1`. Its preflight helper exits nonzero when DB/Git/tool/fixture prerequisites are absent. Mandatory-mode DB helpers reject absent configuration before any `.env` fallback. Every suite emits a JSON report; the runner calls `assert-member-test-report.mjs <report> --require-executed --forbid-required-skips` and propagates nonzero status. No URL/secret appears in arguments or reports.

Add a root Vitest dev dependency pinned to the compatible version resolved in T00, a root `test:member:pilot` script invoking `vitest run --config test/member-access/vitest.config.ts`, and a separate typecheck script for this test tsconfig. The pilot starts compiled API/worker entrypoints as child processes on loopback; it uses public HTTP/package exports rather than importing API-private internals. Scripted model output makes workflow assertions deterministic; manual native/real-provider/real-model runs remain distinct evidence.

- [ ] Write CI-01/02 runner tests using `node --test test/member-access/runner.test.mjs`: missing Postgres fails before Vitest, child environment receives the explicit isolated URL, root `.env` is ignored in mandatory mode, and skipped/zero-case required suites fail the report check. E2E-01–04 in the separate root pilot suite reach effective G4 and next existing activity after provider human approval and deliverable merge.
- [ ] Run targeted checks using the commands in the testing plan. Expect the current missing-environment skip behavior to be caught by the new preflight/report test before CI is considered required.
- [ ] Add Windows/Linux unit/contract checks and an isolated Linux Postgres/worker recovery lane. Pass only declared test env variables through Turbo or invoke package scripts directly after dependency builds; disable test cache for required DB/recovery proof. Keep fork PR jobs secret-free and never execute untrusted fixture PR code with installation secrets.
- [ ] Perform fresh isolated native-client setup and GitHub.com pilot with exact version/commit/report evidence; GHE remains unverified until its selected server version is exercised. Test real cited Q&A separately from scripted semantic output. Run upgrade/rollback and capture failed-publish/recovery evidence.
- [ ] Complete all release gates in the testing plan, review the combined diff and update docs around final behavior. Commit `test(member-access): add required workflow and client release gates`. Package publication, real client installation outside disposable profiles, merge and deployment need their separately authorized release action.

## Execution checkpoints and review policy

- Each task has a failing test for its meaningful behavior, a focused pass and a conventional commit; no fixture-only implementation is presented as runtime proof.
- T02, T03, T05 and T14 are security/durability checkpoints. Review before dependent tasks merge. Other tasks can be implemented natively in order with a whole-branch review, or by fresh implementer/reviewer pairs if the user chooses that execution method.
- Avoid broad unrelated refactors. Gate/service changes require auth/legacy regression checks; DTO/schema changes require SDK/client/MCP conformance. A plan change affecting the approved architecture is recorded with reason before dependent implementation.
- Do not start a model job, external PR, client install, publish or deployment as part of creating these plans. An implementer records which checks actually ran, which skipped and what remains unsupported.

## Plan self-review and coverage ledger

Completed during planning (not product verification):

- [x] All design sections mapped: outcome/scope → T00; repository/boundaries → T01/T06/T08; task/readiness → T04; snapshot/retrieval → T05; CLI/handoff → T07–T09; auth/trust → T02/T07/T09/T10; PR review → T10–T13; gates/durability/SSE → T03/T14/T15; portal/release → T16/T17.
- [x] Shared types/method names defined once and reused; unavailable review and approval capabilities stay explicit during preview.
- [x] Source/assignment validation does not use the tolerant view parser as authority; source approval is separate from publication.
- [x] Five Review Focus failures each assigned to concrete tests/tasks.
- [x] Gate ordering, code-check/G4 cycle, worker-owned retention and API read-only mount covered.
- [x] New files and configuration are planned, not silently installed or executed. No product task above is checked complete.

**Execution status:** implementation was authorized on 20 October 2026. The active branch is `codex/member-access`, based on freshly fetched `origin/master` commit `881b6856e13ed874f25584b05088a466ee35f680`. Resume from the plan-scoped execution ledger; task completion is recorded only after its required checks pass.
