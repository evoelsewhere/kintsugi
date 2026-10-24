# {{unit.title}}: security

## Authentication and authorisation
<!--
required
table: Operation | Role or scope | Check | Rule
guidance: For each operation, who may call it and how that is checked (a token claim, a role lookup, an ownership test on the record); cite the business rule behind it, or - when the legacy code has none.
check: no-placeholder
-->

## Sensitive data
<!--
required
table: Data | Classification | Handling
guidance: Each field that is personal, financial or secret: how it is classified, whether it is masked in responses and logs, encrypted at rest or never stored.
check: one-of(Classification, public|internal|confidential|restricted)
check: no-placeholder
-->

## Abuse protection
<!--
table: Risk | Protection
guidance: Rate limits, lockout, replay protection, input limits and any other control the operations need.
check: no-placeholder
-->
