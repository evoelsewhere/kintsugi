---
kind: batch-job
version: 1
---
# Batch job design: units of kind batch-job

| Path | Template | Required |
| --- | --- | --- |
| overview.md | overview.md | yes |
| schedule.md | schedule.md | yes |
| steps.md | steps.md | yes |
| operations.md | operations.md | no |

## Instructions

Describe the job by when it runs, what it processes in which order and how it restarts. State the volume the job is sized for, the commit unit of every step and exactly what a restart does after a failure at each step. Never describe a step as "process the data": name the tables, files and fields. Cite every business rule from the step that applies it. Write `operations.md` for a job that operators run, monitor or rerun by hand.
