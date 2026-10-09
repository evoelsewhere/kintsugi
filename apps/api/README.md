# apps/api

REST + OpenAPI surface of `kintsugi-app` (ADR-0016: **NestJS 12**, ESM). Serves `/api`,
OpenAPI UI at `/api/docs`. The container also serves the portal's static build, the
Kintsugi MCP server and CLI API (`services/harness-hub`), and the internal job gateway
that runner containers post `JobEvent`s to.

Responsibilities beyond the feature modules below:

- Auth: local username/password sessions + Personal Access Tokens; `AuthProvider`
  interface for Entra ID later (ADR-0008).
- Admin → LLM Providers: runtime provider registry (ADR-0009).

## Layout

```
src/
  main.ts                  bootstrap: global prefix, filters, validation, Swagger
  app.module.ts            root module; imports every feature module
  common/
    config/env.ts          typed environment access
    filters/               uniform error envelope (HttpExceptionFilter)
  modules/
    system/health/         liveness endpoint
    admin/                 A1–A7: projects, users, connectors, llm-providers,
                           harnesses, templates, project-build
    delivery/              B1–B7: portfolio, architecture, factory, workbench,
                           verification, cutover, hypercare
    monitoring/            C1–C5: observability, dashboards, ai-metrics, cost, target-health
    governance/            D1–D6: policies, gates, reviews, audit, risks, rulebook
```

Feature modules map one-to-one onto the functional areas of
[building block view](../../docs/architecture/05-building-block-view.md).

## Feature module pattern

Every feature module is a uniform four-file skeleton:

```
<feature>/
  <feature>.module.ts       @Module with controller + service (+ exports service)
  <feature>.controller.ts   routes, OpenAPI decorators, request schemas on @Body
  <feature>.service.ts      in-memory stub; replace the Map with the Postgres repository
  <singular>.dto.ts         zod request schemas + inferred types + entity interface
```

Conventions:

- **ESM**: relative imports carry the `.js` extension, `"type": "module"` in package.json.
- **Validation** is Standard Schema (ADR-0016): zod schemas on `@Body({ schema })`,
  validated by the global `StandardSchemaValidationPipe`. No class-validator.
- **OpenAPI** comes from decorators: `@ApiTags("<area> · <sub-module>")`,
  `@ApiOperation`, `@ApiOkResponse` / `@ApiCreatedResponse` / `@ApiNoContentResponse`.
- **Errors**: throw Nest `HttpException`s (`NotFoundException`, …); the global
  `HttpExceptionFilter` renders the uniform `{ statusCode, error, message, timestamp, path }` envelope.
- **Naming**: `<area>` routes (`admin/projects`, `delivery/workbench`, …), one service
  per feature, `HttpCode(204)` on deletes.
- **DTO vocabulary** (Phase, Disposition, Role, …) comes from `@kintsugi/domain`;
  never redefine those enums here.

## Adding a feature module

1. Copy the closest existing feature folder under `modules/<area>/`.
2. Rename the four files and the classes (`Projects*` → `YourFeature*`).
3. Adjust the DTO schemas and entity interface to the real resource.
4. Register the module in `app.module.ts`.
5. `pnpm typecheck` and check the generated OpenAPI at `/api/docs`.

## Commands

```bash
pnpm --filter @kintsugi/api dev      # tsc --watch
pnpm --filter @kintsugi/api build
pnpm --filter @kintsugi/api start    # node dist/main.js
```
