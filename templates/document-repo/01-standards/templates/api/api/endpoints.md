# {{unit.title}}: operations

## Operations
<!--
required
table: ID | Method | Path | Summary | Rules | Auth
guidance: One row per operation the unit exposes; ids look like API-001 and never change once written. Summary is one sentence; Rules lists the business rules (ids from the unit's rules) the operation applies, or - when it applies none; Auth names the role or scope that may call it, or public.
check: id-pattern(ID, API-[0-9]{3})
check: one-of(Method, GET|POST|PUT|PATCH|DELETE)
check: refs-resolve(Rules -> rules)
check: no-placeholder
-->

## Requests
<!--
required
table: Operation | Field | In | Type | Required | Constraints
guidance: Every parameter and body field of every operation, by operation id: where it travels (path, query, header or body), its type, whether it is required and its constraints (length, range, format, allowed values).
check: one-of(In, path|query|header|body)
check: one-of(Required, yes|no)
check: no-placeholder
-->

## Responses
<!--
required
table: Operation | Status | Field | Type | Notes
guidance: Every successful response, by operation id: the status, and each field of the body with its type. A response without a body has one row with - as the field.
check: no-placeholder
-->

## Errors
<!--
required
table: Operation | Status | Code | Condition | Message
guidance: Every error an operation returns: the status, an error code of the form ERR-0001, when it is returned and the message. Reuse a code when two operations fail for the same reason.
check: id-pattern(Code, ERR-[0-9]{4})
check: no-placeholder
-->

## Examples
<!--
table: Operation | Request | Response
guidance: One concrete request and response per operation that is not obvious, written out in full.
check: no-placeholder
-->
