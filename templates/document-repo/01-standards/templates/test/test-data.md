# {{unit.title}}: test data

## Data sets
<!--
required
table: Name | Content | Used by | Source
guidance: The data sets the cases need: what each holds (the records and the values that matter), the cases (TC-nnn) that use it and how to obtain or build it. Source is one of fixture (checked in with the tests), generated (built by a script) or masked (a copy of production with sensitive fields masked); never production data as it is.
check: one-of(Source, fixture|generated|masked)
check: no-placeholder
-->

## Environment
<!--
table: Item | Requirement
guidance: What the test environment must provide: services, configuration, the clock, feature flags and any account the cases sign in with (names only, never credentials).
check: no-placeholder
-->

## Cleanup
<!--
guidance: How the data a case creates is removed or reset, so cases can run in any order and repeatedly.
check: max-length(1500)
-->
