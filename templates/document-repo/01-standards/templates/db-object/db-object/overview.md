# {{unit.title}}: database object overview

## Purpose
<!--
required
guidance: One paragraph: what data the object holds or what it computes, who writes it and who reads it.
check: no-placeholder
check: max-length(1500)
-->

## Users
<!--
required
table: User | Access | Notes
guidance: The programs, jobs and reports that read or write the object, and how (read, write, both), found in the legacy code and the data dictionary.
check: one-of(Access, read|write|both)
check: no-placeholder
-->

## Rule coverage
<!--
required
table: Rule | Enforced by | Notes
seed: rules
guidance: Every business rule of the unit appears once; name the constraint, trigger or procedure (from definition.md) that enforces it, or say that the application enforces it. A unit with no rules gets one row with - in each cell.
check: covers-rules(Rule)
check: no-placeholder
-->

## Open questions
<!--
table: Question | Raised by | Status
guidance: What the design could not settle; a rule marked clarify in its review goes here.
check: one-of(Status, open|answered|dropped)
-->
