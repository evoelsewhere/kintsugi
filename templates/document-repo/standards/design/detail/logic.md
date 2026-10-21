# {{unit.title}}: logic

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

## Error handling
<!--
required
table: Code | Condition | Message
guidance: Each error the unit can raise: a code of the form ERR-0001, when it is raised, and the message shown.
check: id-pattern(Code, ERR-[0-9]{4})
check: no-placeholder
-->

## Common components used
<!--
table: Component | Use
guidance: The common components (COM-..., from architecture/common/) the unit calls and for what.
check: refs-resolve(Component -> components)
-->

## Test cases
<!--
required
table: Case | Rule | Input | Expected
guidance: The cases the unit tests must cover: concrete input and expected output, with the rule each one pins.
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->
