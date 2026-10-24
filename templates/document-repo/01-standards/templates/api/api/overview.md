# {{unit.title}}: API overview

## Purpose
<!--
required
guidance: One paragraph: what the API is for, who calls it and what it replaces in the legacy system.
check: no-placeholder
check: max-length(1500)
-->

## Consumers
<!--
required
table: Consumer | Kind | Operations used | Notes
guidance: Every system, screen or batch job that calls the API: its name, its kind (screen, batch, external, internal) and the operations it uses. Read the callers from the legacy code and the topology, not from the target design.
check: one-of(Kind, screen|batch|external|internal)
check: no-placeholder
-->

## Conventions
<!--
table: Topic | Convention
guidance: How this API is shaped where it is not obvious from the operations: versioning, pagination, sorting and filtering, date and money formats, idempotency, the envelope of a response. Refer to the project's conventions in 01-standards/conventions/ instead of repeating them.
check: no-placeholder
-->

## Rule coverage
<!--
required
table: Rule | Operation | Notes
seed: rules
guidance: Every business rule of the unit appears once; name the operation (API-nnn, from endpoints.md) that applies it. A unit with no rules gets one row with - in each cell.
check: covers-rules(Rule)
check: id-pattern(Operation, API-[0-9]{3}|-)
check: no-placeholder
-->

## Open questions
<!--
table: Question | Raised by | Status
guidance: What the design could not settle; a rule marked clarify in its review goes here.
check: one-of(Status, open|answered|dropped)
-->
