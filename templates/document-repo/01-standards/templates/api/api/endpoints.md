# {{unit.title}}: API

## Operations
<!--
required
table: ID | Method | Path | Function | Description
guidance: One row per operation the unit exposes; ids look like API-001 and never change once written; Function is the F-nnn of the basic design it serves.
check: id-pattern(ID, API-[0-9]{3})
check: refs-resolve(Function -> basic)
check: no-placeholder
-->

## Requests and responses
<!--
required
table: Operation | Field | Direction | Type | Required | Notes
guidance: Every field of every request and response, by operation id: its type, whether it is required, and its constraints.
check: one-of(Direction, request|response)
check: one-of(Required, yes|no)
check: no-placeholder
-->

## Errors
<!--
table: Operation | Status | Code | Condition
guidance: The errors each operation returns: the status, the error code and when it is returned.
check: no-placeholder
-->
