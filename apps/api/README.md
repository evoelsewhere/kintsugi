# apps/api

REST + OpenAPI surface of `kintsugi-app` (ADR-0016: **NestJS 12**, ESM). Serves `/api`,
OpenAPI UI at `/api/docs`. The container also serves the portal's static build.

Member API: versioned read-only `/api/member/v1` endpoints (projects, document tree and file) for the Kintsugi CLI and local MCP bridge; see the [member CLI reference](../../docs/reference/member-cli.md).

Responsibilities beyond the feature modules below:

- Auth: local username/password sessions (httpOnly cookie) and personal project-scoped
  Coding Agent Workflow read tokens. Token management uses session permissions; read tokens
  cannot access unmarked legacy routes. Entra ID remains planned (ADRs 0008, 0042).
- Admin → LLM Providers: runtime provider registry (ADR-0009).
- Admin → Agents: the Agent Builder (ADR-0026): built-in agents from `packages/agents/builtin`
  (read-only) plus custom agents and shared skills (migration `012_agents.sql`), with
  versions, copy, import/export and a job-definition preview; changes need `agents.manage`.
- Admin → Git: Git servers (encrypted credentials, pinned SSH host keys) and repositories;
  "Test access" runs `git ls-remote` through `packages/git` (ADR-0025).
- Admin → Projects: projects, applications and the registered repositories they use,
  grouped AS-IS (`legacy`, `legacy-data`) and TO-BE (`document`, `target` with a component),
  plus the rendered `kintsugi.yaml` (ADR-0028, migration `008_projects.sql`).
- Admin → Projects → document writes: publishing `kintsugi.yaml` records a write in
  `workflow.document_write` (migration `009_document_writes.sql`) and enqueues it on the
  worker's `document-write` queue; only the worker commits to the document repo (ADR-0019).
- Delivery → runtime jobs: `POST /api/projects/:id/applications/:appId/stages/assess/run`
  (`jobs.run`) records a stage run in `workflow.job_run` (migration `010_job_runs.sql`) and
  enqueues it on the worker's `job-run` queue; the worker runs it in a job workspace (ADR-0029).
  `GET /api/projects/:id/job-runs[/:runId]` shows runs, steps, artifacts and the document write;
  `GET …/job-runs/:runId/restricted` (`restricted.read`) decrypts the restricted records.
  `GET /api/stages` lists the pipeline stages from the built-in commands (who runs each,
  `runnable` for those the portal can start); `GET /api/job-runs` lists top-level runs across
  projects (`?status=queued,running&projectId&applicationId`).
- Delivery → documents (session only, read-only, from the document repo mirror under
  `KINTSUGI_DATA_DIR`): `GET /api/projects/:id/documents/refs` (default branch tip plus the
  output branches of recent successful runs and writes, `merged` or `open`),
  `GET …/documents/tree?ref&path` and `GET …/documents/file?ref&path` (text up to 2 MiB; `ref` is a commit id or `refs/heads/<branch>`; never `restricted/` or `.git`).
  `GET /api/projects/:id/applications/:appId/stages/:stage/results?ref&compare` builds the
  results of `assess`, `map`, `extract-rules`, `harden` or `understand` (units with their work
  items, the traceability matrix, the AS-IS synthesis documents) with the parsers of
  `@kintsugi/agents/reader` (default ref: the stage's latest successful run, else the default
  branch); `GET …/applications/:appId/results/headlines` gives the overview's headline numbers.
- Delivery → gap answers: `POST …/applications/:appId/understand/gaps/answer` (`documents.resolve`) proposes
  a correction to the named gap's row in its original specification. It checks the document the user read and the
  writer checks its old hash again; the correction is always reviewed in a PR. A merged answer with evidence can
  clear a blocking gap; draft designs remain non-final. See [ADR-0082](../../docs/decisions/0082-design-readiness-drafts-and-in-place-gap-answers.md).
- Cross-project reads (session only): `GET /api/document-writes`
  (`?status=queued,failed&projectId`); `GET /api/monitoring/overview` (counts, what needs
  attention, recent activity, the worker's pg-boss queue counts — `null` when unreadable) and
  `GET /api/monitoring/repositories` (sync state and project links, never credentials).
- AI plan for understanding (ADR-0041): `GET /api/projects/:id/applications/:appId/understand/plan` (session) reads `10-applications/<app>/01-legacy/plan.md` from the default branch, with the current status of its items and `stale` when the catalog was reassessed since; a plan is made by `POST …/stages/plan-understand/run` (`jobs.run`, needs the assess catalog merged).
- Portfolio overview (session only, read-only): `GET /api/monitoring/portfolio` (module `monitoring/portfolio`) places every
  application in the lifecycle (phase derived from its runtime stages, the gate that closes it), lists what a person must
  decide (pending gates, pull requests waiting for review, critical and high findings), the unit funnel of the item
  catalogs and the riskiest units still to analyse. Parts that cannot be read for an application come back `null`.
- Worker health (ADR-0030): `GET /api/monitoring/workers` lists worker processes from
  `workflow.worker_heartbeat` (migration `014_worker_heartbeat.sql`; up when seen < 45 s ago);
  the overview adds `worker.up`, pending gates and `gate-pending` / `worker-down` attention items.
- Governance → gates: `governance.gate` (migration `013_gates.sql`): `GET /api/governance/gates`
  (`?projectId&applicationId&gateKey&status`), `GET …/:id`, `GET …/:id/history` (session);
  `POST /api/governance/gates` (`gates.request` or `gates.decide`); `POST …/:id/decision`
  (`gates.decide`; approve, reject or waive, a note is required to reject or waive).
- Governance → audit: use cases record through the shared `AuditTrail` port
  (`#common/audit/audit-trail.js`, bound globally by the audit module) — never in controllers.
  `GET /api/governance/audit` (`?action=a,b&actor&subject&projectId`) and
  `GET /api/governance/audit/actions` need `audit.read`.
- Governance → telemetry (ADR-0048): `GET /api/monitoring/telemetry/summary`, `…/runs` and `…/runs/:runId/trace` (module `monitoring/telemetry`, read model over
  `monitoring.telemetry_span`, migration `020_telemetry.sql`) need `telemetry.view`; filters `projectId`, `agent`, `from`, `to` (ISO instants, at most 90 days).
- Settings → MCP servers (ADR-0047): `/api/admin/mcp-servers` (module `admin/mcp-servers`, migration `021_mcp_servers.sql`) needs `mcp.manage`; header values are
  encrypted like LLM keys and never returned; `POST …/:id/test` lists a server's tools through the runtime's MCP client; `GET …/choices` (also `agents.manage`)
  gives an agent builder the server ids without addresses or headers.
- Governance → restricted records: `GET /api/governance/restricted-records` (`restricted.read`)
  lists record metadata only (run, step, path, size), never content, so it is not audited;
  reading a record stays the audited per-run read above.

## Layout

```
src/
  main.ts                  bootstrap: .env, schema migrations, filters, validation, Swagger
  app.module.ts            root module; imports every feature module
  common/                  shared kernel — import from here, never duplicate
    config/env.ts          typed environment access (deployment config only)
    db/                    Postgres pool + migrations runner
    queue/job-queue.ts     pg-boss producer for the worker's queues (ADR-0003)
    domain/repository.ts   generic repository port (DDD)
    application/           generic CRUD use cases over the port
    infrastructure/        in-memory repository adapter (dev skeletons)
    security/password.ts   argon2id password hashing (ADR-0008)
    auth/decorators.ts     @Public() / @RequirePermission("code")
    interface/             response envelope + zod helpers (idSchema, stringField)
    filters/               uniform error envelope (HttpExceptionFilter)
  modules/
    system/health/         liveness endpoint
    core/auth/             sessions, global guards, bootstrap admin
    admin/                 A1–A7: projects, users (members), access roles & permissions,
                           connectors, llm-providers (full DDD exemplar), harnesses,
                           templates, project-build
    delivery/              B1–B7
    monitoring/            C1–C5 (read-only routes)
    governance/            D1–D6
```

Feature modules map one-to-one onto the functional areas of
[building block view](../../docs/architecture/05-building-block-view.md).

## Module anatomy (DDD)

Every feature module has the same layered shape:

```
<feature>/
  <feature>.module.ts                     wiring: controller + service + port → adapter
  domain/
    <singular>.ts                         entity + Create<Singular> command (pure types)
    <singular>.repository.ts              port: abstract class extends Repository<T, C>
  application/
    <plural>.service.ts                   use cases (extends CrudService; add more here)
  infrastructure/
    in-memory-<singular>.repository.ts    dev adapter (replace with the Postgres adapter)
  interface/
    <singular>.dto.ts                     zod request schemas + DTO→command mappers
    <plural>.controller.ts                thin HTTP adapter
```

Rules (enforced by review — see AGENTS.md):

- **Dependencies point inward**: `interface → application → domain`; `infrastructure`
  implements `domain` ports. Never import `interface` from `application`/`domain`,
  and never import another module's internals — use its module exports.
- **`domain/` is pure**: types and the port only. No Nest, no zod, no I/O.
- **`interface/` owns transport**: zod schemas (Standard Schema, ADR-0016) and the
  DTO→command mapping. Controllers stay thin; no business logic.
- **`application/` owns use cases**: orchestration, validation, error semantics
  (`NotFoundException`, `ConflictException`). Storage-agnostic.
- **`infrastructure/` owns I/O**: Postgres adapters (see `admin/llm-providers`),
  in-memory adapters for skeletons. No HTTP types here.
- **Shared vocabulary** (Phase, ProjectRole, `ThinkingLevel`, `RuntimeAgentId`, …)
  comes from `@kintsugi/domain`; provider/agent contracts from `@kintsugi/runtime-sdk`.
  Never redefine them in this app.

## Shared kernel (`src/common/`)

Import it through the `#common/*` alias (Node subpath imports in `package.json`), for example `import { CrudService } from "#common/application/crud.service.js"`, and another module through `#modules/<area>/<module>/index.js`, its public surface (lint rejects imports of its internals). Relative imports stay within a feature module; lint rejects any that climb two or more folders.

| Piece | Import | Use |
|---|---|---|
| `Repository<T, C>` | `#common/domain/repository.js` | base of every feature port |
| `newId()` | `#common/domain/ids.js` | stable record ids |
| `CrudService<T, C>` | `#common/application/crud.service.js` | base of every feature service |
| `Page<T>`, `PageQuery`, `toPage()` | `#common/application/pagination.js` | pagination payload |
| `InMemoryRepository<T, C>` | `#common/infrastructure/in-memory.repository.js` | dev adapter base |
| `idSchema`, `stringField()` | `#common/interface/dto.js` | zod helpers for request schemas |
| `pageQuerySchema`, `parsePageQuery()` | `#common/interface/pagination.js` | `?limit&offset` query schema |
| `ok()`, `ResponseInterceptor`, `ApiSuccess<T>` | `#common/interface/response.js` | uniform response envelope |
| `sleep()`, `retry()`, `chunk()` | `#common/util/async.js` | async utilities |
| `nowIso()` | `#common/util/time.js` | one clock format (ISO-8601 UTC) |
| `getPool`, `ensureSchema` | `#common/db/pool.js` | Postgres access + migrations (advisory-locked) |
| `getJobQueue`, `closeJobQueue` | `#common/queue/job-queue.js` | pg-boss producer for the worker's queues (contract in `@kintsugi/orchestrator/queues`) |
| `withTransaction`, `Queryable` | `#common/db/pool.js` | one unit of work across several statements |
| `AuditTrail`, `AUDIT_ACTIONS`, `auditRecord()`, `changedFields()` | `#common/audit/audit-trail.js` | the one audit port: `record()` fail-closed before protected content, `recordChange()` after a change |
| `@Public()`, `@RequirePermission()`, `@CurrentActor()`, `Actor` | `#common/auth/decorators.js` | route access + the caller passed to use cases |
| `sessionToken`, `setSessionCookie`, `CSRF_HEADER` | `#common/auth/session-cookie.js` | session transport (cookie or bearer) + CSRF rule |
| `encryptSecret`, `decryptSecret` | `@kintsugi/secrets` | AES-256-GCM with `KINTSUGI_SECRET_KEY` (shared with services/runtime) |
| `HttpExceptionFilter` | `#common/filters/…` | uniform error envelope |

If two modules need the same logic, it belongs in `common/` (or in `@kintsugi/domain`
when it is vocabulary or pure domain logic).

## Response envelope

Every response is uniform — success and error are a pair (controllers return plain
values; `ResponseInterceptor` and `HttpExceptionFilter` do the wrapping):

```jsonc
// success (lists paginate: data = Page<T>)
{ "success": true, "data": { … } }

// error
{ "success": false, "statusCode": 404, "error": "NOT_FOUND",
  "message": "Project 42 not found", "timestamp": "…", "path": "/api/admin/projects/42" }
```

## Database

- One database (**ADR-0010**), **one schema per domain**: `core` (cross-cutting:
  `schema_migrations`, users, sessions…), `admin`, `delivery`, `monitoring`,
  `governance`, `knowledge`, `workflow`.
- Migrations live in `migrations/*.sql`; each creates the schema it owns and
  **qualifies table names explicitly** (`admin.llm_provider`) — never rely on
  `search_path`. Applied automatically at startup, recorded in `core.schema_migrations`.
- Secrets are encrypted (AES-256-GCM, `KINTSUGI_SECRET_KEY`) and referenced from
  configs as `{ secretId }`; the API never returns credential values.

## Identity & access (ADR-0008)

Local username/password sessions first (Entra ID later behind `AuthProvider`):

- **Sign-in** `POST /api/auth/login` → session in an **httpOnly, SameSite=Strict cookie**
  (`kintsugi_session`, path `/api`, `Secure` when `KINTSUGI_PUBLIC_URL` is https). The
  token is stored as a SHA-256 hash in `core.session` (7-day expiry) and never appears in
  a response body. `POST /api/auth/logout` revokes it and clears the cookie;
  `GET /api/auth/me` returns the user with access roles and effective permissions. Non-browser
  clients may send the token as `Authorization: Bearer` instead.
- **CSRF**: unsafe requests (anything but GET/HEAD/OPTIONS) that are not
  bearer-authenticated must send `x-kintsugi-csrf: 1` (`CsrfGuard`) — sign-in included.
- **Lockout**: 5 failed sign-ins within 15 minutes lock the account until the oldest
  failure ages out (429). Per account, in memory (single API process). Unknown usernames
  cost the same hash check, so timing does not reveal which accounts exist.
- **Route protection** is global (`CsrfGuard` → `AuthGuard` → `PermissionsGuard` in
  `modules/core/auth`): every route needs a session unless marked `@Public()` (login, health); routes can
  require permission codes with `@RequirePermission("code", …)` (any one of them; a
  method-level decorator overrides the class-level one). Every write route is gated;
  reads of shared catalogs only need a session. Use cases that depend on who calls
  receive the caller via `@CurrentActor()`.
- **Access roles**: primary access roles (`admin`, `contribute`, `user`) and admin-defined
  access sub-roles (`dev`, `ba`, `tester`, …). A member holds one primary access role plus optional access sub-roles.
- **Permissions are dynamic**: codes live in `core.permission` and are added by
  **migration** — the portal's matrix reads the table, so new codes appear automatically
  and are granted per access role there. Grants are stored in `core.role_permission`.
- **Bootstrap admin**: created on startup when no users exist, from
  `KINTSUGI_BOOTSTRAP_ADMIN_USER` (default `admin`) and `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD`
  (required, at least 8 characters — there is no default; startup fails without it).
  Change the password after first sign-in.
- **Guard rails** (members & access-role use cases):
  - you can only assign access roles, grant permissions, and manage members whose permissions
    you hold yourself — `members.manage` / `roles.manage` do not allow self-escalation or
    taking over a stronger account;
  - the installation keeps at least one enabled `admin` access role, which keeps
    `members.manage` and `roles.manage`, and nobody removes or disables themselves;
  - a member holds exactly one primary access role;
  - resetting a password or disabling a member ends their sessions.
- **Password hashing**: argon2id (`@node-rs/argon2`, 19 MiB / 2 passes / 1 lane) stored as a
  PHC string. Older scrypt hashes, or argon2id hashes with other parameters, are re-hashed
  at the next successful sign-in.

## Adding a feature module

1. Copy the closest existing module under `modules/<area>/` (a stub is enough —
   they are uniform).
2. Rename the classes (`Project` → `YourEntity`, `Projects*` → `YourFeature*`).
3. Adjust `domain/<singular>.ts` (entity + command) and the zod schemas.
4. Expose the routes you need (read-only modules expose GET only).
5. Register the module in `app.module.ts`, then `pnpm typecheck` and check `/api/docs`.
6. When the data lands: add `migrations/NNN_<name>.sql` (your domain schema) and swap
   `InMemory…Repository` for a Postgres adapter bound in the module.

## Commands

```bash
pnpm --filter @kintsugi/api dev      # tsc --watch
pnpm --filter @kintsugi/api build
pnpm --filter @kintsugi/api start    # node dist/main.js
pnpm --filter @kintsugi/api test     # vitest
```

## Tests

- `test/unit/`: pure units (password hashing, sign-in throttle, error filter, environment).
- `test/integration/`: the real `AppModule`, booted like `src/main.ts` on an ephemeral port and driven over HTTP: session cookie and CSRF, guard order, lockout, member and access-role guard rails, session revocation, hash upgrades, LLM provider permissions and credential confidentiality, Git registration, projects with their repository rules and rendered `kintsugi.yaml`, the monitoring overview and the cross-project lists.
- Integration tests need Postgres: the server comes from `DATABASE_URL` (environment, else the repo-root `.env`). Each test file creates its own `kintsugi_api_test_*` database and drops it afterwards; the database named in `DATABASE_URL` is never touched. Without `DATABASE_URL` the integration suites are skipped.
- NestJS injection needs decorator metadata: `vitest.config.ts` enables it in Vite's oxc transform.
- Known gaps are pinned with `it.fails` (the test passes while the gap exists); turn them into plain `it` when fixing the gap.

