# ADR-0095: Remove the API modules that kept their writes in memory

- Status: Accepted
- Date: 2026-11-01
- Decision register: D109

## Context

Fifteen API modules were skeletons from the module template: their only store was the `InMemoryRepository` dev adapter (a `Map` in the API process), and `app.module.ts` mounted them in every installation. Their routes answered `200` with an empty list, accepted writes behind `setup.manage`, `projects.manage`, `workitems.manage` or `governance.manage`, and lost them at the next restart. With several API processes, each would have held different data, and every `POST` grew the process's memory without a bound. Their lists returned a bare array instead of the `Page<T>` every other list returns. The OpenAPI document advertised about sixty operations that did nothing durable, so a reader took `/api/monitoring/cost` or `/api/governance/risks` for real features.

Nothing called them. No portal page, CLI command, client package, test or document used their routes, and no other module imported them; they were wired only from `app.module.ts`. Postgres is the only datastore (ADR-0010), and the engine stays small (ADR-0014, ADR-0023).

## Decision

1. **The fifteen modules are removed**, with their controllers, services, in-memory repositories and wiring:

   | Module | Routes (`/api/…`) | Callers | Fate |
   |---|---|---|---|
   | `admin/connectors` | `admin/connectors` (CRUD) | none | removed |
   | `admin/harnesses` | `admin/harnesses` (CRUD) | none | removed |
   | `admin/project-build` | `admin/project-build` (CRUD) | none | removed |
   | `admin/templates` | `admin/templates` (CRUD) | none | removed |
   | `delivery/architecture` | `delivery/architecture` (CRUD) | none | removed |
   | `delivery/factory` | `delivery/factory` (CRUD) | none | removed |
   | `delivery/workbench` | `delivery/workbench` (CRUD) | none | removed |
   | `governance/policies` | `governance/policies` (CRUD) | none | removed |
   | `governance/reviews` | `governance/reviews` (CRUD) | none | removed |
   | `governance/risks` | `governance/risks` (CRUD) | none | removed |
   | `monitoring/ai-metrics` | `monitoring/ai-metrics` (read) | none | removed |
   | `monitoring/cost` | `monitoring/cost` (read) | none | removed |
   | `monitoring/dashboards` | `monitoring/dashboards` (read) | none | removed |
   | `monitoring/observability` | `monitoring/observability` (read) | none | removed |
   | `monitoring/target-health` | `monitoring/target-health` (read) | none | removed |

   A former route answers `404`, and `/api/docs` lists none of them.
2. **Two permissions are removed with them** by migration `048_remove_skeleton_module_permissions.sql`, together with their grants: `setup.manage` and `governance.manage`, which only these modules checked. `projects.manage` stays (projects and applications check it), and `workitems.manage` stays (the stage decisions check it). The permission catalog test holds the catalog to the permissions the code checks.
3. **A module stores its data in Postgres from its first commit.** The module template in `apps/api/README.md` no longer offers an in-memory adapter; `InMemoryRepository` stays in the shared kernel as a test double of a repository port.

## Consequences

- The API serves only routes that keep what they are given; the OpenAPI document is the map of what exists.
- A functional area of the building block view without a module (AI metrics, cost, target health, policies, risks…) has no API until it is built, with its migration and Postgres adapter.
- An installation that granted `setup.manage` or `governance.manage` to a custom role loses those grants, which did nothing durable.

## Alternatives considered

- **Answer `501 Not Implemented` from the controllers.** It keeps routes nobody calls in the API and in its documentation.
- **Unmount the modules but keep their code.** Code that is not built, run or tested drifts; the module template and git history keep the shape.
- **Give each module a Postgres adapter.** Building fifteen features that no client asks for goes against keeping the engine small.
