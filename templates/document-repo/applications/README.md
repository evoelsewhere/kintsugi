# `applications/`

- Written by: people and Kintsugi (the folder scaffold), per folder below
- Serves: P1-P7, everything application-specific
- Auto-commit: per folder — see each folder's README

One folder per application in scope. The sample application `billing-web` shows the structure;
replace it with the applications named in `kintsugi.yaml`.

```text
applications/<app>/
  inputs/        P2: INTENT.md, graph/ and telemetry/ attached by people
  assessment/    P1: assess and understand outputs
  to-be/         P2: requirements.md, design.md
  gates/         G1, G2, G5, G6 records
  units/         P1-P5: one directory per unit
  cutover/       P6: plan.md, runbook.md, rollback.md, go-no-go.md
  operate/       P7: hypercare-report.md, handover.md
  generated/     rebuilt application aggregates (README, architecture, data model, integrations)
```

Vocabulary: a **unit** is the thing being migrated (`<app>/<module>/<unit>`); an **item** is only
an entry in the application's assessment catalog (`<module>/<item>`).
