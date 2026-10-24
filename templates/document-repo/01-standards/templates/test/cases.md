# {{unit.title}}: test cases

## Cases
<!--
required
table: Rule | ID | Level | Target | Preconditions | Input | Expected
seed: rules
guidance: At least one case per business rule of the unit; ids look like TC-001 and never change once written. Level is ut (unit), it (integration) or st (system); Target is the design item the case exercises (an operation API-nnn, an event EVT-nnn, a step STEP-nn, a column COL-nn) or - when the unit has no design; Preconditions are the data that must exist; Input and Expected are concrete values, including the message or status.
check: covers-rules(Rule)
check: id-pattern(ID, TC-[0-9]{3})
check: one-of(Level, ut|it|st)
check: no-placeholder
-->

## Boundary and failure cases
<!--
table: ID | Rule | Target | Scenario | Expected
guidance: The cases the rules imply but do not state as rules: each limit at, just below and just above its value; empty, missing and oversized input; the failures the unit names (an unavailable dependency, a duplicate, a timeout). Ids continue the numbering of the Cases table.
check: id-pattern(ID, TC-[0-9]{3})
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->

## Not tested here
<!--
table: Rule | Reason
guidance: A business rule that is proven somewhere else (a shared component, a system test of another unit) or cannot be tested, and why; a rule listed here must still have a row in Cases that points to where it is proven.
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->
