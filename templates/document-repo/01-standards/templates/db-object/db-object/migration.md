# {{unit.title}}: migration

## Steps
<!--
required
table: Step | Statement | Rollback | Notes
guidance: The steps that bring an existing database to this definition, in order, each with the statement that undoes it; say which steps are safe to run while the applications are up.
check: no-placeholder
-->

## Existing data
<!--
required
table: Data | Conversion | Check
guidance: What happens to the rows that already exist: how each is converted, defaulted or rejected, and how to check afterwards that nothing was lost.
check: no-placeholder
-->

## Cutover
<!--
guidance: How readers and writers switch to the new object (a view, a dual write, a maintenance window), and when the old object is removed.
check: max-length(1500)
-->
