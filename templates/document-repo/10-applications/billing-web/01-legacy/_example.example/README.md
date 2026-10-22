# Format samples: a unit's legacy folder

- Written by: nobody — these are format samples
- Serves: teach the file formats of a unit's folder in `01-legacy/` (P1)
- Auto-commit: no — the name contains `.example`, so nothing loads or seeds these files

Copy a sample to a real unit folder (`01-legacy/<module>/<unit>/`) and adapt its content:

| Sample | Format |
| --- | --- |
| `rules.md.example` | the index of the unit's rules (a table linking each rule's file) |
| `rules/<rule id>.md.example` | one rule: specification, evidence and version history |
| `rules-review.md.example` | the human rule verdicts (a table) |
| `trace.md.example` | the unit traceability record |

The unit's card is sampled in `../../02-modern/_example.example/README.md.example`.

Rule ids in `rules.md` are deterministic and citation-derived (each rule carries the source
citation it was derived from), so human verdicts in `rules-review.md` keep matching across
re-extractions. A verdict whose rule id is absent from the current extraction is reported as
orphaned, never silently applied.
