# {{unit.title}}: definition

## Objects
<!--
required
table: Object | Type | Definition
guidance: Each object the unit defines: its name, its type and the statement that creates it, with columns, types and constraints written out.
check: one-of(Type, table|view|index|sequence|procedure|function|trigger)
check: no-placeholder
-->

## Columns
<!--
required
table: Object | Column | Type | Null | Default | Notes
guidance: Every column of every table or view: its type, whether it may be null, its default and what it holds. Map each to the legacy field it replaces in Notes.
check: one-of(Null, yes|no)
check: no-placeholder
-->

## Constraints and indexes
<!--
table: Object | Name | Kind | Columns | Rule
guidance: Each primary key, foreign key, unique, check constraint and index, the columns it covers and the business rule it enforces (or -).
check: one-of(Kind, primary|foreign|unique|check|index)
check: refs-resolve(Rule -> rules)
check: no-placeholder
-->

## Access paths
<!--
table: Query | Used by | Served by
guidance: The queries that matter for performance, who runs them and the index or plan that serves each.
check: no-placeholder
-->
