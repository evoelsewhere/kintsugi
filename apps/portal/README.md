# apps/portal

Web experience of the four pillars (Admin, Delivery, Monitoring, Governance) plus live
runtime-job streams over SSE. Built as a static bundle and served by `kintsugi-app`
(ADR-0017: **Vite + React 19 + shadcn/ui**).

The visual language is specified in [`DESIGN.md`](../../DESIGN.md): an achromatic
Vercel/Geist system. Follow it strictly.

## Layout

```
src/
  index.css              design tokens (--ds-*, --geist-*), Geist fonts, type classes
  main.tsx               entry
  App.tsx                routes (react-router)
  layout/
    app-shell.tsx        header + sidebar + content (max --geist-page-width)
    header.tsx           64px header, shadow-as-border bottom edge
    sidebar.tsx          primary navigation
  components/
    page-header.tsx      page title + description
    metric-card.tsx      dashboard metric (Prompt 1 in DESIGN.md)
    area-card.tsx        functional-area placeholder card
    ui/                  shadcn-style primitives (owned in-repo): button, card,
                         input, badge, status-dot
  lib/
    api.ts               typed fetch wrapper (uniform error envelope)
    use-health.ts        API liveness hook
    utils.ts             cn() class helper
  pages/
    overview.tsx         programme health, pipeline P0–P7
    admin.tsx            A1–A7
    delivery.tsx         B1–B7
    monitoring.tsx       C1–C5
    governance.tsx       D1–D6
```

## Design rules (DESIGN.md)

- **Achromatic**: `#FAFAFA` canvas, `#171717` text, blue `#0072F5` only for links and
  focus rings. Status colors only as 10px indicator dots (`StatusDot`), never as fills.
- **Shadow-as-border**: no CSS `border` on containers; `box-shadow: 0 0 0 1px …` via the
  `--ds-shadow-*` tokens.
- **Three weights**: 400 / 500 / 600 only — never 700. Headings use aggressive negative
  letter-spacing (`.h-display`, `.h-title`, `.h-subtitle` in `index.css`).
- **Focus**: double ring — `0 0 0 2px #FFF, 0 0 0 4px #0072F5` (`.focus-ring`).
- **Spacing**: 4px base unit (`--geist-space-*`); separate sections with spacing, not
  divider lines. Radius: 6px controls, 12px cards, 9999px badges.
- **Motion**: no `transform`/`opacity` effects on interactive elements; hover changes
  color only.
- **Fonts**: Geist Sans + Geist Mono, self-hosted via `@fontsource/geist-*` (offline-capable
  self-hosted deployment).

## Conventions

- Design tokens live in `src/index.css`; components consume them through `@theme`
  mappings (`bg-surface`, `text-text-secondary`, …) and the `--ds-*` / `--geist-*` CSS vars.
- shadcn-style primitives live in `src/components/ui/` and are owned by this repo —
  edit them freely, keep them aligned with DESIGN.md.
- API access goes through `src/lib/api.ts` (uniform error envelope from the API's
  `HttpExceptionFilter`). Live job/event streams will use SSE on `/api`.
- Deep links rely on the `kintsugi-app` serving `index.html` for unknown paths.

## Commands

```bash
pnpm --filter @kintsugi/portal dev
pnpm --filter @kintsugi/portal build
pnpm --filter @kintsugi/portal typecheck
```
