# Format samples

- Written by: nobody — these are format samples
- Serves: teach the file formats of a unit directory (P1-P5, gate G4)
- Auto-commit: no — the name contains `.example`, so nothing loads or seeds these files

Copy a sample to a real unit directory (`<module>/<unit>/`) and adapt its content:

| Sample | Format |
| --- | --- |
| `unit.md.example` | the unit state file (identity, state, links, gate references) |
| `rules.json.example` | the machine rule extraction |
| `rules-review.json.example` | the human rule verdicts |
| `trace.json.example` | the unit traceability record |
| `reviews/G4.md.example` | the unit's G4 gate record |

Rule ids in `rules.json` are deterministic and citation-derived (each rule carries the source
citation it was derived from), so human verdicts in `rules-review.json` keep matching across
re-extractions. A verdict whose rule id is absent from the current extraction is reported as
orphaned, never silently applied.
