# `applications/billing-web/assessment/`

- Written by: the Kintsugi runtime job `assess`
- Serves: the Assessment context (P1): what the estate is
- Auto-commit: no — outputs arrive as pull requests (the defaults cover `units/` state and `generated/` only)

Assessment outputs for this application, all Markdown (the files appear as the jobs that write them run):

| File | Content |
| --- | --- |
| `inventory.md` | the figures of record: languages, directories, size distribution, the most complex files |
| `topology.md` | the domains, the edges between them, the largest leaves, entry points and flows, with a diagram |
| `catalog/index.md`, `catalog/<module>.md` | the catalog of items (`<module>/<item>`): a card per item with its leaves, links and files |
| `ASSESSMENT.md` | the assessment synthesis |
| `ARCHITECTURE.mmd` | the architecture diagram |
| `tools/extract_topology.py` | the topology extraction script the job wrote |

Per-unit evidence (rules, findings, traceability, specifications) lives with its unit under
`units/<module>/<unit>/understanding/`. The per-file inventory and the raw topology are scratch of the run and are not committed.
