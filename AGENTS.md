# AGENTS.md — guidance for coding agents working on Kintsugi

Kintsugi is a TypeScript monorepo (pnpm + Turborepo) for an AI-driven migration & modernization portal. Start at `docs/README.md` (documentation map). Read `docs/architecture/05-building-block-view.md` and `docs/architecture/concepts/runtime-and-member-harnesses.md` before making structural changes.

## Conventions
- TypeScript, ESM, Node ≥ 22, `strict` + `noUncheckedIndexedAccess`.
- Shared vocabulary lives in `packages/domain`; never redefine Phase, Disposition, Role or HarnessId elsewhere.
- Two agent worlds, kept separate:
  - **Kintsugi Runtime** (`services/runtime`, `runtime/`): Kintsugi's own agents on pi, behind `packages/runtime-sdk`. They never write to project repos.
  - **Member harnesses** (Claude Code, Copilot, ChatGPT/Codex), served by `services/harness-hub` through `packages/harness-sdk`. Kintsugi supplies context and ingests results; it does not drive them.
- pi-specific code lives only in `services/runtime`. Harness-specific rendering and telemetry code lives only in `services/harness-hub`.
- Member-harness assets live in `harness/` (Agent Skills format). Do not hand-write harness-specific copies (`.claude/skills`, `.github/agents`, …); they are rendered.
- Pin `@earendil-works/*` packages to exact versions.
- Architecture decisions go in `docs/decisions/NNNN-title.md` (copy `docs/decisions/template.md`); update the decision register in `docs/decisions/README.md`.
- Documentation follows Diátaxis + arc42 (see `docs/README.md` → Conventions): English, company-neutral, one purpose per page, facts in one place.
- Deployment is a self-hosted Docker Compose package: no Kubernetes, no multi-tenancy, Postgres is the only datastore, Git is the source of truth for documents (ADR-0006/0007/0010). Do not add infrastructure dependencies without an ADR.

## Commands
- `pnpm install` · `pnpm typecheck` · `pnpm build` · `pnpm test`

## Security
- Never run the pi runtime against customer code outside a sandbox, and always mount the code read-only (ADR-0004).
- Never commit credentials; use `.env` (gitignored) locally.
