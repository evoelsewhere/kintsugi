---
title: "Security architecture"
status: "draft"
version: 1
---
# Security architecture

How the target is protected. Rules in this document are what the security reviewers and the units' `security.md` designs cite; a unit's design refines them for its own operations and never weakens them.

## Identity and access

| Concern | Decision |
| --- | --- |
| Authentication | <!-- identity provider, protocol, session or token lifetime --> |
| Authorisation model | <!-- roles, permissions, attributes; where a decision is made --> |
| Service-to-service access | <!-- how a component proves who it is --> |
| Administrative access | <!-- who, how it is approved, how it is recorded --> |

## Roles

| Role | May | May not | Source in the legacy system |
| --- | --- | --- | --- |
| <!-- Billing clerk --> | <!-- search and read invoices --> | <!-- close a period --> | <!-- the legacy profile or group --> |

## Data protection

| Data class | At rest | In transit | In logs | In non-production |
| --- | --- | --- | --- | --- |
| confidential | <!-- encrypted --> | <!-- TLS --> | <!-- masked --> | <!-- masked copy only --> |
| restricted | <!-- encrypted, key held outside the application --> | <!-- TLS --> | <!-- never --> | <!-- never --> |

Classes are defined in [data-architecture.md](data-architecture.md).

## Secrets and keys

| Secret | Held in | Rotated | Read by |
| --- | --- | --- | --- |
| <!-- database password --> | <!-- secret store --> | <!-- every 90 days --> | <!-- component --> |

Secrets never appear in the repositories, in the document repo or in logs.

## Audit and monitoring

| Event | Recorded | Kept | Reviewed by |
| --- | --- | --- | --- |
| Sign-in and failed sign-in | <!-- who, when, from where --> | <!-- period --> | <!-- team --> |
| Change of data of a restricted class | <!-- who, what, before and after --> | <!-- period --> | <!-- team --> |
| Administrative action | <!-- who, what --> | <!-- period --> | <!-- team --> |

## Threats and controls

| Threat | Control | Verified by |
| --- | --- | --- |
| <!-- injection --> | <!-- parameterised queries only; input validation at the boundary --> | <!-- review rule, scan --> |
| <!-- broken access control --> | <!-- the check is made on the server, per operation --> | <!-- test --> |
| <!-- sensitive data exposure --> | <!-- classification rules above --> | <!-- review --> |

## Compliance

| Requirement | Source | How the design meets it |
| --- | --- | --- |
| <!-- regulation or policy --> | <!-- name and clause --> | <!-- control, document --> |
