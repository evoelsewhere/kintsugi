# {{unit.title}}: layout

## Items
<!--
required
table: ID | Item | Type | Source | Display rules
guidance: Each item on the screen in reading order; ids look like ITM-001 and never change once written. Type is the control (text, number, date, select, checkbox, button, table, label), Source says where its value comes from (the user, a field of the data, a constant, a calculation) and Display rules are format, masking, defaults and when it is enabled or visible.
check: id-pattern(ID, ITM-[0-9]{3})
check: no-placeholder
-->

## Tables and lists
<!--
table: Table | Column | Source | Sort | Notes
guidance: For each table or list on the screen, its columns in order, where each value comes from and how rows are ordered and paged.
check: no-placeholder
-->

## States
<!--
table: State | When | What changes
guidance: The screen states beyond the normal one: first load, no results, loading, read-only, error. Say which items change.
check: no-placeholder
-->

## Accessibility and responsiveness
<!--
table: Topic | Requirement
guidance: Keyboard order, labels, error announcement and how the layout behaves on a narrow screen; refer to the project's UI conventions instead of repeating them.
check: no-placeholder
-->
