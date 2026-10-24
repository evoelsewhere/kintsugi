# {{unit.title}}: events and validations

## Events
<!--
required
table: ID | Event | Trigger | Action | Rule | Outcome
guidance: What happens when the user acts, in the order a user meets them; ids look like EVT-001 and never change once written. Trigger is the user action (click Search, leave a field, load); Action is what the system does, named precisely (the query, the call, the navigation); Rule is the business rule applied or -; Outcome is what the user sees next.
check: id-pattern(ID, EVT-[0-9]{3})
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->

## Validations
<!--
required
table: ID | Item | Check | Condition | Message | Rule
guidance: Each check made on input: ids look like VAL-001; Item is the item id from layout.md (ITM-nnn), Check is when it runs (on leave, on submit), Condition is exactly when it fails and Message is the error code from the table below.
check: id-pattern(ID, VAL-[0-9]{3})
check: id-pattern(Message, ERR-[0-9]{4})
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->

## Messages
<!--
required
table: Code | Severity | Text
guidance: Each message the screen can show: a code of the form ERR-0001 (INF- or WRN- for information and warnings, written the same way), its severity and the text exactly as displayed.
check: one-of(Severity, error|warning|info)
check: no-placeholder
-->

## Common components used
<!--
table: Component | Use
guidance: The common components (COM-..., from 02-architecture/common/) the screen calls and for what.
check: refs-resolve(Component -> components)
-->
