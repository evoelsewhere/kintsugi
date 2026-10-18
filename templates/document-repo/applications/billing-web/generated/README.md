# `applications/billing-web/generated/`

- Written by: Kintsugi (`rebuild_aggregates.py` and the application Overview run)
- Serves: the rebuilt application aggregates
- Auto-commit: yes — `applications/*/generated/**` is in the default auto-commit paths

Rebuilt from the per-unit files after merge, never hand-authored or edited in a run's pull
request:

| File | Content |
| --- | --- |
| `topology.json` | the unit topology fragments merged |
| `rules_result.json`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md` | every unit's rules and data objects |
| `SECURITY_FINDINGS.md` | the scorecard and every unit's findings |
| `traceability.json`, `traceability.md` | one row per understood unit |
| `README.md` | the index of the unit specifications |
| `architecture.md`, `data-model.md`, `integrations.md` | application overview documents (on-demand Overview run) |

Do not edit files here directly: a merge of a unit file triggers the rebuild, and the rebuild is
deterministic (same inputs, same files).
