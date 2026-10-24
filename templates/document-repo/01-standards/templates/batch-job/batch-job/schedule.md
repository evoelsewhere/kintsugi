# {{unit.title}}: schedule and inputs

## Schedule
<!--
required
table: Item | Value | Notes
guidance: When the job runs (a cron expression, or the event or file that starts it), its time zone, its window and how long it may run, and what happens when a run is late or overlaps the next.
check: no-placeholder
-->

## Parameters
<!--
table: Name | Type | Required | Default | Notes
guidance: Each parameter the job takes: its name, type, whether it is required and its default; the parameter a rerun passes is named here.
check: one-of(Required, yes|no)
check: no-placeholder
-->

## Inputs
<!--
required
table: Source | Kind | Selection | Volume
guidance: Every file or table the job reads, with the selection written out (the filter, the period) and the volume it is sized for.
check: one-of(Kind, file|table|queue|api)
check: no-placeholder
-->

## Outputs
<!--
required
table: Target | Kind | Content | Volume
guidance: Every file, table, message or report the job writes, and its content in one line.
check: one-of(Kind, file|table|queue|api|report)
check: no-placeholder
-->
