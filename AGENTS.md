# AGENTS.md — guidance for coding agents working on Kintsugi

Kintsugi is a TypeScript monorepo (pnpm + Turborepo) for an AI-driven migration & modernization portal. Start at `docs/README.md` (documentation map). Read `docs/architecture/05-building-block-view.md` and `docs/architecture/concepts/runtime-and-member-harnesses.md` before making structural changes.

## Conventions
- TypeScript, ESM, Node ≥ 22, `strict` + `noUncheckedIndexedAccess`.
- Shared vocabulary lives in `packages/domain`; never redefine Phase, ProjectRole or HarnessId elsewhere.
- Two agent worlds, kept separate:
  - **Kintsugi Runtime** (`services/runtime`): a generic agent kernel on pi, behind `packages/runtime-sdk` (ADR-0023). Agents are data supplied whole with each job: built-in read-only agents for the understanding phases plus admin-created ones, packaged as Claude Code agent files + Agent Skills with their commands, workflows, scripts and hooks. The built-in content is a set of **plugins** under `packages/agents/builtin/plugins/` (`reverse_engineering` and `modernize`, both for the runtime; adapted from the upstream code-modernization content, ADR-0027, ADR-0035; the `design` stage of `modernize` generates the unit design sets, ADR-0049, ADR-0068) shown in Administration → Plugins; the Agent Builder (ADR-0026) manages the admin-created ones. There is no agent configuration in project repos. Runtime jobs never write to project repos.
  - **Member harnesses** (Claude Code, Copilot, ChatGPT/Codex) are not integrated: the Coding Agent Workflow was removed (ADR-0067) and later plugins attach any such integration.
- pi-specific code lives only in `services/runtime`.
- Kintsugi ships no stack-specific content. Stack/project specifics belong in the project's single document repo (everything except code, ADR-0028), as plain documents under `01-standards/` (conventions, mappings, review rules) and member plugins under `plugins/`; the neutral starter lives in `templates/document-repo/`.
- The document repo holds **Markdown only** (ADR-0042, `docs/reference/document-formats.md`): front matter, tables and cards. Its layout is numbered in reading order (ADR-0051, `docs/reference/document-repo.md`): `00-project/`, `01-standards/`, `02-architecture/`, `03-transition/`, and per application `10-applications/<app>/01-legacy/` (the old system) and `02-modern/` (the new one) on the same `<module>/<unit>` paths, with no gate records (gates live in the portal). The JSON a run passes between its steps is scratch under `scratch/<app>/`, never committed. Paths are built only in `packages/domain/src/document-layout.ts` (mirrored by each plugin's identical `scripts/paths.py`); scripts write documents with `scripts/docmd.py`, readers parse them with `hooks/reader/document.ts`.
- Plugins are in the Claude Code plugin format (ADR-0015, ADR-0035): the built-in ones live in `packages/agents/builtin/plugins/` (`reverse_engineering`, `modernize`); stack-specific plugins live in the document repo's `plugins/`. Validate with `claude plugin validate --strict`. Do not hand-write harness-specific copies (`.claude/skills`, `.github/agents`, …).
- Pin `@earendil-works/*` packages to exact versions.
- Architecture decisions go in `docs/decisions/NNNN-title.md` (copy `docs/decisions/template.md`); update the decision register in `docs/decisions/README.md`.
- Documentation follows Diátaxis + arc42 (see `docs/README.md` → Conventions): English, company-neutral, one purpose per page, facts in one place.
- Deployment is a self-hosted Docker Compose package: no Kubernetes, no multi-tenancy, Postgres is the only datastore, Git is the source of truth for documents (ADR-0006/0007/0010). Do not add infrastructure dependencies without an ADR.
- Keep the engine small (ADR-0014, ADR-0023): no code graph or language parsers, no unit-discovery configuration, no runtime-agent configuration in repos. `services/runtime` knows no agent or use case; new kernel tools are added there by code, with a security review.

## Backend rules (apps/api)

- Feature modules follow the DDD anatomy in [`apps/api/README.md`](apps/api/README.md): `domain/` (entity + port), `application/` (use cases), `infrastructure/` (adapters), `interface/` (controllers + zod DTOs), plus the `<feature>.module.ts` wiring.
- Dependencies point **inward only**: `interface → application → domain`; `infrastructure` implements `domain` ports. Never import `interface` from `application`/`domain`, never import another module's internals — use its module exports.
- Import the shared kernel as `#common/*` and other modules only through their public surface `#modules/<area>/<module>/index.js` (the portal uses `@/*`); never climb two or more folders with `../../` (lint enforces it).
- Reuse the shared kernel in `apps/api/src/common/` (`Repository`, `CrudService`, `InMemoryRepository`, zod helpers, pagination, response envelope, `retry`/`sleep`/`chunk`, `nowIso`, Postgres pool, secret crypto). If two modules need the same logic, it goes to `common/` or `@kintsugi/domain` — never duplicated per module.
- **Common-first, both directions**: before implementing anything reusable (≥2 call sites, extensible by design), build the common piece first and implement on top of it. Before writing any logic, scan `common/` and `@kintsugi/domain` — if something fits, use it instead of writing new code.
- Every response uses the uniform envelope: `{ success: true, data }` / `{ success: false, statusCode, error, message, timestamp, path }`. Controllers return plain values; do not hand-wrap responses.
- Database: one database, **one schema per domain** (`core`, `admin`, `delivery`, `monitoring`, `governance`, `knowledge`, `workflow`). Migrations (`apps/api/migrations/*.sql`) create their schema and fully qualify table names — no `search_path` reliance.
- Credentials (LLM keys, Git tokens) are stored **encrypted** (ADR-0009, `KINTSUGI_SECRET_KEY`) and never returned by the API. Provider settings live in the database and are managed in the portal — not in environment variables.
- **Identity & access** (ADR-0008): permission codes live in `core.permission` and are added by **migration** (they appear in the UI automatically); route protection is global — mark public routes `@Public()` and gate the rest with `@RequirePermission("<code>")`. Never hardcode permission lists outside the catalog.

## Commits
- Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <subject>`, with a lowercase imperative subject.
  - Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
  - Breaking changes: `!` after the type/scope, or a `BREAKING CHANGE:` footer.
- Example: `feat(templates): add standards samples`.
- Do not add AI co-author or attribution trailers.

## Commands
- `pnpm install` · `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm test` · `make dev` (API on :3000 and the worker, both with rebuild + restart; portal on :5173)

## Security
- Run runtime jobs and script steps only in their job workspace: source and inputs read-only, writes only to the job's output and scratch directories, no credentials in the environment (ADR-0029).
- Never commit credentials; use `.env` (gitignored) locally.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
