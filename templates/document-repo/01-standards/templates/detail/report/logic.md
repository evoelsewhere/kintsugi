# {{unit.title}}: report logic

## Parameters
<!--
required
table: Name | Type | Required | Default
guidance: Each parameter the user can set: its name, type, whether it is required (yes or no) and its default.
check: one-of(Required, yes|no)
check: no-placeholder
-->

## Layout
<!--
required
table: Column | Source | Aggregation | Format
guidance: Each column or total in reading order: where its value comes from, how it is aggregated (none, sum, count, ...) and how it is formatted.
check: no-placeholder
-->

## Business rules
<!--
required
table: Rule | Logic | Function
seed: rules
guidance: Every business rule of the unit appears once, with the exact logic that implements it and the function (F-nnn from the basic design) it belongs to.
check: covers-rules(Rule)
check: refs-resolve(Function -> basic)
check: no-placeholder
-->

## Test cases
<!--
required
table: Case | Rule | Input | Expected
guidance: The cases the report tests must cover: concrete parameters and data and the expected figures, with the rule each one pins.
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->
