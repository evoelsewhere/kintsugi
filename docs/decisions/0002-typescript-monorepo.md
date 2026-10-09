# ADR-0002: TypeScript monorepo (pnpm + Turborepo)

- Status: Proposed
- Date: 2026-10-09

## Decision
All first-party code is TypeScript on Node ≥ 22, in one pnpm workspace orchestrated by Turborepo: `apps/*` (portal, api), `services/*` (orchestrator, knowledge, runtime, harness-hub), `packages/*` (shared libraries).

## Rationale
pi, its extensions and SDK are TypeScript; sharing domain types between portal, API and runner removes a translation layer. Python may be added later as an isolated service for document conversion (xlsx/docx → md) if a library requires it.
