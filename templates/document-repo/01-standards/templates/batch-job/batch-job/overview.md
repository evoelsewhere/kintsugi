# {{unit.title}}: batch job overview

## Purpose
<!--
required
guidance: One paragraph: what the job produces or changes, for whom, and what the legacy job was.
check: no-placeholder
check: max-length(1500)
-->

## Dependencies
<!--
required
table: Job or system | Direction | Why
guidance: The jobs, files and systems this job depends on (upstream) or that depend on it (downstream), and why; a job with none has one row with - in each cell.
check: one-of(Direction, upstream|downstream)
check: no-placeholder
-->

## Rule coverage
<!--
required
table: Rule | Handled by | Notes
seed: rules
guidance: Every business rule of the unit appears once; name the step (STEP-nn, from steps.md) that applies it. A unit with no rules gets one row with - in each cell.
check: covers-rules(Rule)
check: no-placeholder
-->

## Open questions
<!--
table: Question | Raised by | Status
guidance: What the design could not settle; a rule marked clarify in its review goes here.
check: one-of(Status, open|answered|dropped)
-->
