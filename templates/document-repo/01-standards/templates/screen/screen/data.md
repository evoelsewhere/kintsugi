# {{unit.title}}: data

## Reads
<!--
required
table: Entity | Fields | Filter | Used by
guidance: Each entity the screen reads, the fields it needs, the filter (written out) and the event or item that triggers the read.
check: no-placeholder
-->

## Writes
<!--
table: Entity | Operation | Fields | Used by
guidance: Each change the screen makes to data, and the event that makes it; say where the transaction starts and ends.
check: one-of(Operation, create|update|delete)
check: no-placeholder
-->

## Concurrency
<!--
guidance: What happens when two users edit the same record (the legacy locking, and what the target does instead).
check: max-length(1500)
-->
