# ADR-0017: Portal is a Vite + React SPA with shadcn/ui

- Status: Accepted
- Date: 2026-10-09
- Decision register: D11

## Context

`apps/portal` is the web experience for the four pillars (Admin, Delivery, Monitoring, Governance). It is built as a static bundle and served by `kintsugi-app` (ADR-0006 single-host package). The register proposed "React SPA (Vite) + shadcn/ui" and left it open only for confirmation.

Forces:

- Single self-hosted Docker Compose package: the portal must build to static files served by the same container as the API; no separate Node process or CDN.
- Heavy operational UI: boards (work items × stages), dashboards, gate status, job streams via SSE (ADR-0010), rulebook editors and resolved views. Needs a solid component system, tables and data fetching — not just pages.
- The team already standardizes on TypeScript ESM and a small, auditable dependency set.

## Decision

- **Vite** is the build tool and dev server; **React 19** with TypeScript (ESM, `moduleResolution: Bundler`).
- **shadcn/ui** is the component system, on **Tailwind CSS v4** (`@tailwindcss/vite`): components are copied into `src/components/ui/` and owned by the repo (no runtime UI package dependency), styled with `class-variance-authority` + `tailwind-merge`.
- The production build is static (`vite build` → `dist/`), served by `kintsugi-app`; the API is reached on the same origin under `/api` (dev server proxies `/api` to the API port).
- Client-side data layer is kept thin for now: `fetch` against the OpenAPI-described REST API plus SSE for live job/event streams. A data-fetching library is introduced only when the first real screens need caching.

## Consequences

- Fast dev loop, small bundle, and full control over every UI component (shadcn copy-in model fits the "no locked-in vendor" spirit of ADR-0013).
- shadcn/ui conventions (Radix primitives, `cn()` helper, Tailwind theme tokens in CSS variables) are repo-wide UI vocabulary; design tokens live in `src/index.css`.
- Tailwind v4 is CSS-first config: theming happens in CSS, not a `tailwind.config.js`.
- Portal must not import `@kintsugi/domain` runtime values into heavy bundles without checking size; type-only imports are fine.

## Alternatives considered

- **Next.js**: rejected; SSR/RSC machinery is unnecessary for an authenticated internal SPA served from one host, and it would add a second runtime to the deployment story.
- **Material UI / Ant Design / Mantine**: rejected; heavier bundles and a closed theming model, while shadcn/ui gives owned, editable components.
- **Plain Vite + custom components**: rejected; reinventing accessible primitives costs more than adopting shadcn/ui.
