# `applications/billing-web/units/`

- Written by: people and the Kintsugi runtime (per unit file, see the unit's README)
- Serves: P1-P5; one directory per unit of this application
- Auto-commit: `unit.md` and `task.md` of every unit are auto-committed; the rest arrives as pull requests

One directory per unit, named `<module>/<unit>`, holding the unit's own evidence:

```text
units/<module>/<unit>/
  unit.md                      unit state and gate references (auto-committed)
  understanding/               P1: what is known about the unit
    as-is.md                   AS-IS specification
    understanding.md           provenance record (marks the unit understood)
    rules.md data-objects.md   machine rule extraction
    rules-review.md            human rule verdicts (a table)
    findings.md topology.md trace.md
  task.md design.md            P4 task pack (auto-committed) and design
  reviews/G4.md                the unit's G4 record
  verify/                      P5 golden cases, equivalence runs and test evidence
```

The unit id is the full `<app>/<module>/<unit>`. A unit is created when an item from
`../assessment/catalog/` is selected for migration; "item" names only that catalog entry.

`_example.example/` holds format samples (unit state, rule extraction, rule verdicts,
traceability, the G4 record). It is not loaded and not seeded; copy a sample to a real unit
directory and adapt it.
