# `10-applications/billing-web/01-legacy/`

- Written by: the Kintsugi runtime (`assess`, `plan-understand`, `understand`) and people (rule verdicts)
- Serves: P1, the reverse engineering of the old system: what it is and what it does
- Auto-commit: only `plan.md`; everything else arrives as pull requests

At the top, the assessment of the application (the files appear as the jobs that write them run):

| File or folder | Content |
| --- | --- |
| `inventory.md` | the figures of record: languages, directories, size distribution, the most complex files |
| `topology.md` | the domains, the edges between them, the largest leaves, entry points and flows, with a diagram |
| `assessment.md` | the assessment synthesis |
| `architecture.mmd` | the domain diagram of the synthesis |
| `_catalog/index.md`, `_catalog/<module>.md` | the catalog of items (`<module>/<item>`): a card per item with its leaves, links and files |
| `_tools/extract_topology.py` | the topology extraction script the job wrote |
| `plan.md` | the AI plan of what to understand next (advice, replaced by every planning run) |

Below it, one folder per understood unit, `<module>/<unit>/`:

| File | Content |
| --- | --- |
| `spec.md` | the AS-IS specification |
| `understanding.md` | the provenance record: digest, source commit, run (its presence marks the unit understood) |
| `rules.md`, `rules/<rule id>.md` | the index of the unit's business rules and one file per rule |
| `rules-review.md` | the human verdicts on the rules (a table, written by people) |
| `data-objects.md`, `findings.md`, `topology.md`, `trace.md` | data objects, security findings, the unit's topology, its traceability |

The unit's card, its design and its task pack are on the same `<module>/<unit>/` path in `../02-modern/`.
The per-file inventory and the raw topology are scratch of a run and are never committed.

`_example.example/` holds format samples of a unit's files; it is not loaded and not seeded.
