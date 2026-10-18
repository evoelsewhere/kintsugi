# `applications/billing-web/assessment/`

- Written by: the Kintsugi runtime jobs (`assess`, and the map, extract-rules and harden steps of `understand`)
- Serves: P1 assessment evidence for this application
- Auto-commit: no — outputs arrive as pull requests (the defaults cover `units/` state and `generated/` only)

Assessment outputs for this application (the files appear as the jobs that write them run):

| File | Content |
| --- | --- |
| `catalog.json` | the assessment catalog of items (`<module>/<item>`) |
| `ASSESSMENT.md` | the assessment synthesis |
| `ARCHITECTURE.mmd` | the architecture diagram |
| `topology.json`, `topology.summary.txt`, `call-graph.mmd`, `data-lineage.mmd`, `critical-path.mmd` | topology and its derived views |
| `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `rules_result.json` | business rule and data object extraction |
| `SECURITY_FINDINGS.md` | security findings of the harden scan |

Per-unit evidence (rules, findings, traceability, specifications) lives with its unit under
`units/<module>/<unit>/`; the assessment working area (`understand/`) holds run scratch only.
