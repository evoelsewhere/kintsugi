---
title: "Integration"
status: "draft"
version: 1
---
# Integration

How the components and the outside world talk to each other: which interfaces exist, in which style, and the rules every one of them follows. An interface's own operations are written in the design of the `api` units, not here.

## Interfaces

| Id | From | To | Style | Protocol and format | Trigger | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| INT-001 | <!-- web --> | <!-- api --> | request-response | <!-- HTTPS, JSON --> | <!-- user action --> | <!-- team --> |

`Style` is one of request-response, event, file transfer, database link or batch; `Id` never changes once approved.

## Conventions every interface follows

| Topic | Convention |
| --- | --- |
| Versioning | <!-- how an interface changes without breaking callers --> |
| Naming | <!-- paths, fields, events: casing and vocabulary --> |
| Dates, numbers and money | <!-- formats, time zone, currency and rounding --> |
| Identifiers and correlation | <!-- how a request is traced across components --> |
| Pagination and limits | <!-- page size, maximum payload --> |
| Idempotency | <!-- which operations may be retried and how --> |

## Errors and retries

| Situation | Behaviour |
| --- | --- |
| A call fails with a temporary error | <!-- retry count, back-off, who retries --> |
| A call fails with a permanent error | <!-- error shape, logging, who is told --> |
| A dependency is down | <!-- timeout, circuit breaker, fallback --> |
| A message cannot be processed | <!-- dead-letter handling and the operator action --> |

Error codes are defined once, in the unit designs, as `ERR-nnnn`; this section says how they are carried.

## Messages and events

| Message | Producer | Consumers | Schema | Delivery |
| --- | --- | --- | --- | --- |
| <!-- InvoiceClosed --> | <!-- batch --> | <!-- api, reporting --> | <!-- link to its definition --> | at-least-once / exactly-once |

## Interfaces during the migration

The bridges between the legacy and the target systems are in `../03-transition/coexistence.md`; list here only the permanent interfaces.
