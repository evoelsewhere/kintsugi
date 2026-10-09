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
    panel-shell.tsx      sidebar + content column (max --geist-page-width); owns the settings modal
    sidebar.tsx          logo + app name + version, search, grouped nav, user card; collapsible
    nav-config.tsx       config-driven navigation — add pages here
  components/
    page-header.tsx      breadcrumb + title + actions row
    modal.tsx            dialog (shadow-modal, swift entrance)
    metric-card.tsx      dashboard metric (Prompt 1 in DESIGN.md)
    area-card.tsx        functional-area placeholder card
    ui/                  shadcn-style primitives (owned in-repo): button, card,
                         input, badge, status-dot, modal
  lib/
    app-info.ts          app name + version shown in the sidebar
    api.ts               typed fetch wrapper (uniform response envelope)
    api/providers.ts     LLM provider registry client (Settings → Providers)
    use-health.ts        API liveness hook
    utils.ts             cn() class helper
  pages/
    overview.tsx         programme health, pipeline P0–P7
    admin.tsx            A1–A7
    delivery.tsx         B1–B7
    monitoring.tsx       C1–C5
    governance.tsx       D1–D6
    settings/
      settings-modal.tsx           modal opened from the user card / Settings nav entry
      settings-tabs.tsx            section tab bar
      sections/
        providers-section.tsx      LLM provider registry (full CRUD + bindings)
        provider-form-dialog.tsx   per-provider form (supported list from the API)
        appearance-section.tsx     theme (light / dark / system)
        diagnostics-section.tsx    installation health snapshot
        placeholder-section.tsx    reusable "not implemented yet" skeleton
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
- **Navigation is config-driven**: add or reorder entries in `layout/nav-config.tsx`
  and register the route in `App.tsx`. The sidebar renders groups, icons, badges and
  search filtering from that config.
- **Settings opens as a modal** from the sidebar user card or the Settings nav entry
  (`pages/settings/settings-modal.tsx`). Sections are self-contained components under
  `pages/settings/sections/`; register them in `settings-tabs.tsx` (`TABS`).
- **Provider forms adapt per provider**: `GET /api/admin/llm-providers/supported`
  returns the builtin providers + models (read from the pinned pi catalog) and the
  custom wire protocols; `provider-form-dialog.tsx` renders fields accordingly.
- API access goes through `src/lib/api.ts` (uniform envelope: `{ success, data }` /
  `{ success: false, statusCode, … }`). Feature clients (e.g. `lib/api/providers.ts`)
  wrap their endpoints. Live job/event streams will use SSE on `/api`.
- Provider settings (Settings → Providers) are stored in the database through the API;
  credentials are write-only and encrypted server-side (ADR-0009) — never shown again.
- Deep links rely on the `kintsugi-app` serving `index.html` for unknown paths.

## Commands

```bash
pnpm --filter @kintsugi/portal dev
pnpm --filter @kintsugi/portal build
pnpm --filter @kintsugi/portal typecheck
```
