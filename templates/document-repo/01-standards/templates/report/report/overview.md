# {{unit.title}}: report overview

## Purpose
<!--
required
guidance: One paragraph: what question the report answers, who reads it and how often, and what the legacy report was.
check: no-placeholder
check: max-length(1500)
-->

## Delivery
<!--
required
table: Format | Channel | When | Audience
guidance: How the report reaches its readers: the format (screen, pdf, csv, xlsx), the channel (on demand, e-mail, file drop) and when, and who receives it.
check: one-of(Format, screen|pdf|csv|xlsx)
check: no-placeholder
-->

## Rule coverage
<!--
required
table: Rule | Handled by | Notes
seed: rules
guidance: Every business rule of the unit appears once; name the column (COL-nn, from layout.md) or the filter that applies it. A unit with no rules gets one row with - in each cell.
check: covers-rules(Rule)
check: no-placeholder
-->

## Open questions
<!--
table: Question | Raised by | Status
guidance: What the design could not settle; a rule marked clarify in its review goes here.
check: one-of(Status, open|answered|dropped)
-->
