---
title: "Target conventions"
status: "draft"
version: 1
---
# Target conventions

> Extract these from the scaffolded target base; do not invent them here. Converters and reviewers follow only what is written in this file.

## Layering

| Layer | Contains | May depend on |
| --- | --- | --- |
| Presentation | screens, view models | Application |
| Application | use cases, API controllers | Domain |
| Domain | entities, business rules | nothing |
| Infrastructure | data access, external clients | Domain (implements its ports) |

Projects and modules, and the dependency direction between them. A reference against the direction is a finding (`RR-001`).

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Namespaces and packages | <!-- --> | `com.example.billing.invoices` |
| Classes | <!-- --> | `InvoiceSearchService` |
| Files and folders | <!-- --> | <!-- --> |
| Database objects | <!-- --> | `invoice_line` |
| Constants and error codes | <!-- --> | `ERR-0001` |

## Idioms

| Concern | The way it is done here | Common component |
| --- | --- | --- |
| Error handling | <!-- --> | <!-- COM-ERR-01 --> |
| Logging | <!-- --> | <!-- COM-LOG-01 --> |
| Configuration | <!-- --> | <!-- --> |
| Dependency injection | <!-- --> | - |
| Data access and transactions | <!-- --> | <!-- COM-DATA-01 --> |

## Build and CI

| Step | Command | Required check |
| --- | --- | --- |
| Build | <!-- --> | <!-- must pass --> |
| Unit tests | <!-- --> | <!-- must pass --> |
| Static analysis | <!-- --> | <!-- no new findings --> |

## Forbidden

| API, library or pattern | Why | Use instead |
| --- | --- | --- |
| <!-- --> | <!-- --> | <!-- --> |
