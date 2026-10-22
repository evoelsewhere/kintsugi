# {{unit.title}}: batch job logic

## Schedule and inputs
<!--
required
table: Item | Value | Notes
guidance: When the job runs (a cron expression or the event that starts it), its parameters, the files or tables it reads, and the volume it is sized for.
check: no-placeholder
-->

## Steps
<!--
required
table: Step | Action | Function | Commit unit
guidance: The processing steps in order: what each reads and writes, the function (F-nnn from the basic design) it belongs to, and when its work is committed.
check: refs-resolve(Function -> basic)
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

## Restart and error handling
<!--
required
table: Code | Condition | Message | Restart
guidance: Each error the job can raise: a code of the form ERR-0001, when it is raised, the message logged and what a restart does after it.
check: id-pattern(Code, ERR-[0-9]{4})
check: no-placeholder
-->

## Common components used
<!--
table: Component | Use
guidance: The common components (COM-..., from 02-architecture/common/) the job calls and for what.
check: refs-resolve(Component -> components)
-->

## Test cases
<!--
required
table: Case | Rule | Input | Expected
guidance: The cases the job tests must cover: concrete input data and expected output or table state, with the rule each one pins.
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->
