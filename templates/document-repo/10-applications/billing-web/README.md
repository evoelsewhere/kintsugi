# `10-applications/billing-web/`

- Written by: per folder below
- Serves: P1-P4 for this application
- Auto-commit: per folder — see each folder's README

The overview of the `billing-web` application and the map of its folders. Replace the sample name with the application's, and fill the overview from the assessment and the intent.

## Overview

| Item | Value |
| --- | --- |
| Purpose | <!-- one sentence: what the application does for whom --> |
| Business owner | <!-- name --> |
| Technical owner | <!-- name --> |
| Legacy technology | <!-- language, framework, database; the assessment has the figures --> |
| Target | <!-- the components and repositories, see 02-modern/design.md --> |
| Wave | <!-- from ../../00-project/portfolio/wave-plan.md --> |
| Status | <!-- assessed, understood, in design, in build, live --> |

## Folders

| Folder | Content |
| --- | --- |
| `00-inputs/` | what people attach: the intent, graphs, telemetry |
| `01-legacy/` | the old system: the assessment, the catalog, the understanding plan, and per unit what is known about it |
| `02-modern/` | the new system: the requirements, the application's design, and per unit its card, its design and its task pack |
| `_generated/` | the read models rebuilt from the units after a merge |

## Where to start

| You want to | Read |
| --- | --- |
| know why and how the application is migrated | `00-inputs/INTENT.md` |
| know what the old system is and does | `01-legacy/` (the assessment, then a unit's `spec.md`) |
| know what the new system is | `02-modern/design.md`, then a unit's design sets |
| see the state of every unit | the portal, or `_generated/` |

Gate decisions about this application (G1, G2) are recorded in the portal (Governance → Gates).
