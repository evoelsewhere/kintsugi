# apps/api

REST + OpenAPI surface of `kintsugi-app` (ADR-0016: **NestJS 12**, ESM). Serves `/api`,
OpenAPI UI at `/api/docs`. The container also serves the portal's static build, the
Kintsugi MCP server and CLI API (`services/harness-hub`), and the internal job gateway
that runner containers post `JobEvent`s to.

Responsibilities beyond the feature modules below:

- Auth: local username/password sessions (httpOnly cookie); Personal Access Tokens and an
  `AuthProvider` interface for Entra ID are planned (ADR-0008).
- Admin → LLM Providers: runtime provider registry (ADR-0009).

## Layout

```
src/
  main.ts                  bootstrap: .env, schema migrations, filters, validation, Swagger
  app.module.ts            root module; imports every feature module
  common/                  shared kernel — import from here, never duplicate
    config/env.ts          typed environment access (deployment config only)
    db/                    Postgres pool + migrations runner
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
    admin/                 A1–A7: projects, users (members), roles & permissions,
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
- **Shared vocabulary** (Phase, Disposition, Role, `ThinkingLevel`, `RuntimeAgentId`, …)
  comes from `@kintsugi/domain`; provider/agent contracts from `@kintsugi/runtime-sdk`.
  Never redefine them in this app.

## Shared kernel (`src/common/`)

| Piece | Import | Use |
|---|---|---|
| `Repository<T, C>` | `common/domain/repository.js` | base of every feature port |
| `newId()` | `common/domain/ids.js` | stable record ids |
| `CrudService<T, C>` | `common/application/crud.service.js` | base of every feature service |
| `Page<T>`, `PageQuery`, `toPage()` | `common/application/pagination.js` | pagination payload |
| `InMemoryRepository<T, C>` | `common/infrastructure/in-memory.repository.js` | dev adapter base |
| `idSchema`, `stringField()` | `common/interface/dto.js` | zod helpers for request schemas |
| `pageQuerySchema`, `parsePageQuery()` | `common/interface/pagination.js` | `?limit&offset` query schema |
| `ok()`, `ResponseInterceptor`, `ApiSuccess<T>` | `common/interface/response.js` | uniform response envelope |
| `sleep()`, `retry()`, `chunk()` | `common/util/async.js` | async utilities |
| `nowIso()` | `common/util/time.js` | one clock format (ISO-8601 UTC) |
| `getPool`, `ensureSchema` | `common/db/pool.js` | Postgres access + migrations (advisory-locked) |
| `withTransaction`, `Queryable` | `common/db/pool.js` | one unit of work across several statements |
| `@Public()`, `@RequirePermission()`, `@CurrentActor()`, `Actor` | `common/auth/decorators.js` | route access + the caller passed to use cases |
| `sessionToken`, `setSessionCookie`, `CSRF_HEADER` | `common/auth/session-cookie.js` | session transport (cookie or bearer) + CSRF rule |
| `encryptSecret`, `decryptSecret` | `@kintsugi/secrets` | AES-256-GCM with `KINTSUGI_SECRET_KEY` (shared with services/runtime) |
| `HttpExceptionFilter` | `common/filters/…` | uniform error envelope |

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
  `GET /api/auth/me` returns the user with roles and effective permissions. Non-browser
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
- **Roles**: primary roles (`admin`, `contribute`, `user`) and admin-defined sub-roles
  (`dev`, `ba`, `tester`, …). A member holds one primary role plus optional sub-roles.
- **Permissions are dynamic**: codes live in `core.permission` and are added by
  **migration** — the portal's matrix reads the table, so new codes appear automatically
  and are granted per role there. Grants are stored in `core.role_permission`.
- **Bootstrap admin**: created on startup when no users exist, from
  `KINTSUGI_BOOTSTRAP_ADMIN_USER` (default `admin`) and `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD`
  (required, at least 8 characters — there is no default; startup fails without it).
  Change the password after first sign-in.
- **Guard rails** (members & roles use cases):
  - you can only assign roles, grant permissions, and manage members whose permissions
    you hold yourself — `members.manage` / `roles.manage` do not allow self-escalation or
    taking over a stronger account;
  - the installation keeps at least one enabled `admin`, the `admin` role keeps
    `members.manage` and `roles.manage`, and nobody removes or disables themselves;
  - a member holds exactly one primary role;
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
```
