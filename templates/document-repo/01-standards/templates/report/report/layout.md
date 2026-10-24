# {{unit.title}}: layout

## Columns
<!--
required
table: ID | Column | Source | Aggregation | Format | Rules
guidance: Each column or total in reading order; ids look like COL-01 and never change once written. Source says where the value comes from, Aggregation how it is combined (none, sum, count, min, max, avg), Format how it is shown, Rules the business rules it applies (or -).
check: id-pattern(ID, COL-[0-9]{2})
check: one-of(Aggregation, none|sum|count|min|max|avg)
check: refs-resolve(Rules -> rules)
check: no-placeholder
-->

## Grouping and order
<!--
required
table: Level | Group by | Order by | Subtotal
guidance: How rows are grouped and ordered, level by level, and whether each level has a subtotal.
check: one-of(Subtotal, yes|no)
check: no-placeholder
-->

## Page and empty result
<!--
table: Topic | Behaviour
guidance: Page size and headers, what the report shows when nothing matches, and how it behaves when a run is very large.
check: no-placeholder
-->
