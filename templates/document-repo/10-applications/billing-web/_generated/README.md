# `10-applications/billing-web/_generated/`

- Written by: Kintsugi (`rebuild_aggregates.py` and the application Overview run)
- Serves: the read models rebuilt from the units
- Auto-commit: yes — `10-applications/*/_generated/**` is in the default auto-commit paths

Rebuilt from the per-unit files after merge, never hand-authored or edited in a run's pull
request:

| File | Content |
| --- | --- |
| `BUSINESS_RULES.md`, `DATA_OBJECTS.md` | every unit's rules and data objects |
| `SECURITY_FINDINGS.md` | the scorecard and every unit's findings |
| `traceability.md` | the totals (front matter) and one row per understood unit |
| `README.md` | the index of the unit specifications |
| `architecture.md`, `data-model.md`, `integrations.md` | application overview documents (on-demand Overview run) |

Do not edit files here directly: a merge of a unit file triggers the rebuild, and the rebuild is
deterministic (same inputs, same files).
