# {{unit.title}}: screen logic

## Layout
<!--
required
table: Item | Type | Source | Notes
guidance: Each item on the screen in reading order: its name, the control type, where its value comes from and any display rule (format, masking, enabled when).
check: no-placeholder
-->

## Events
<!--
required
table: Event | Trigger | Handler | Rule
guidance: What happens when the user acts: the event, what triggers it, the function that handles it (F-nnn) and the business rule it applies, or a dash when it applies none.
check: refs-resolve(Handler -> basic)
check: refs-resolve(Rule -> rules)
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

## Messages and errors
<!--
required
table: Code | Condition | Message
guidance: Each message the screen can show: a code of the form ERR-0001, when it is shown, and the text exactly as displayed.
check: id-pattern(Code, ERR-[0-9]{4})
check: no-placeholder
-->

## Common components used
<!--
table: Component | Use
guidance: The common components (COM-..., from 02-architecture/common/) the screen calls and for what.
check: refs-resolve(Component -> components)
-->

## Test cases
<!--
required
table: Case | Rule | Input | Expected
guidance: The cases the screen tests must cover: concrete input and expected output, with the rule each one pins.
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->
