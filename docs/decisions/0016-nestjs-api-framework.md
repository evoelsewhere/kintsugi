# ADR-0016: NestJS is the API framework for `apps/api`

- Status: Accepted
- Date: 2026-10-09
- Decision register: D10

## Context

`apps/api` exposes the REST + OpenAPI surface for the four pillars (Admin, Delivery, Monitoring, Governance) inside the `kintsugi-app` container. The register left the framework open between **NestJS** and **Fastify** (raw or via `@nestjs/platform-fastify`).

Forces:

- The repo is TypeScript ESM, Node ≥ 22 (`strict`, `noUncheckedIndexedAccess`), and the monorepo convention is ESM throughout (AGENTS.md).
- The API must stay maintainable as it grows to cover identity, connectors, LLM provider registry, jobs, gates, audit — i.e. a modular structure with clear seams for `AuthProvider` (ADR-0008) and the LLM provider registry (ADR-0009).
- NestJS 12 ships ESM-ready packages and scaffolds ESM projects by default (`"type": "module"`, `module`/`moduleResolution: NodeNext`), so the ESM convention no longer conflicts with the framework. It still relies on legacy decorators (`experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata`).
- OpenAPI generation is a requirement; both options have mature tooling, but Nest's `@nestjs/swagger` derives the spec from the same decorators that define the routes.

## Decision

- **NestJS 12** is the API framework (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/swagger`).
- `apps/api` is an **ESM NestJS application**: `"type": "module"`, `tsconfig` with `module`/`moduleResolution: NodeNext`, relative imports with explicit `.js` extensions, legacy decorator settings (`experimentalDecorators`, `emitDecoratorMetadata`) and `reflect-metadata` imported first in `main.ts`.
- Validation follows Nest 12's **Standard Schema** route (`@Body({ schema })` + `StandardSchemaValidationPipe`) instead of `class-validator`/`class-transformer`, keeping DTO schemas as plain Zod/Standard Schema objects that also feed OpenAPI generation.
- The default **Express** HTTP adapter is used. The Fastify adapter stays a drop-in option (`@nestjs/platform-fastify`) if profiling later shows a need; application code must not depend on Express-specific APIs.
- Build with `tsc` (no bundler). Decorator metadata rules out `tsx`/esbuild-style dev runners.

## Consequences

- Modular scaffolding (modules, providers, controllers, guards, interceptors), DI for the seams named in ADRs 0008/0009.
- OpenAPI document generated from decorators (`SwaggerModule`), served from `kintsugi-app` alongside the portal's static build.
- Legacy decorator dependency: revisit if TypeScript drops `emitDecoratorMetadata`; Nest's own mitigation path is explicit `@Inject()` tokens.
- ESM keeps `@kintsugi/domain`, `@kintsugi/runtime-sdk` and `@kintsugi/harness-sdk` (ESM packages) directly importable from the API.

## Alternatives considered

- **Fastify (raw)**: faster and lighter, but no opinionated modular architecture; every seam (DI, validation, OpenAPI, guards) would be hand-rolled. Rejected for a codebase expected to grow across four pillars.
- **NestJS + Fastify adapter**: viable and kept as an option; not chosen now because the Express adapter is the default and best-supported path, and the performance difference is irrelevant at this scale.
- **CommonJS NestJS app** (classic scaffold): rejected; conflicts with the repo-wide ESM convention and with importing the ESM `@kintsugi/*` packages.
