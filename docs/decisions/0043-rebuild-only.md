# ADR-0043: Kintsugi rebuilds; it offers no choice of transformation strategy

- Status: Accepted (supersedes the per-strategy pipelines named as a follow-up in [ADR-0028](0028-remove-rulebook-single-document-repo.md))
- Date: 2026-10-21
- Decision register: D59

## Context

The first design described the delivery method as one pipeline configured per application by a **7R strategy**: the application's disposition (retire, retain, rehost, replatform, refactor, re-architect, rebuild, repurchase) selected which phases ran and which built-in pipeline applied. Kintsugi's value is in rebuilding: understanding what a legacy system does and re-creating it on a new architecture. Most of the other strategies change no code or need no reverse engineering, so a per-application choice added vocabulary, a database column, a manifest field, a recommendation function and documentation for paths the product does not take. No built-in pipeline per strategy was ever written.

The product today covers the reverse engineering of the as-is system (the `assess` and `understand` stages of P1). The phases after it are the planned shape of the rebuild.

## Decision

1. **Every application is rebuilt.** An application has no disposition: not in `kintsugi.yaml`, not in the database (`admin.application`), not in the API or the portal, not in the shared vocabulary of `packages/domain`.
2. **One pipeline.** The delivery pipeline is P0–P7 for a rebuild. A project that needs another shape declares its own under `pipelines:` and names it on an application with `pipeline:`; a pipeline no longer has an `appliesTo`.
3. **The scorecard ranks, it does not choose.** Its weighted total maps to a rebuild priority (`scorecardPriority`), used for the wave plan.
4. **The assessment states a rebuild outlook** instead of recommending a strategy: what makes the application easy or hard to rebuild, what to understand first, the main risks.
5. **Scope.** Documentation and code describe what exists: reverse engineering. Later phases are marked as planned.

## Consequences

- Migration `019_application_drop_disposition.sql` drops the column; `kintsugi.yaml` files that still carry `disposition` or `appliesTo` fail validation (unknown key), which is intended: there is nothing to keep compatible.
- The in-memory portfolio-items API module, whose only purpose was to record dispositions, is removed.
- The `modernize` member plugin still ships the stages of the later phases; whether they all stay is decided when those phases are built.
