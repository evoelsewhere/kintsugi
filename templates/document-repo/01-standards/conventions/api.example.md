---
title: "API conventions"
status: "draft"
version: 1
---
# API conventions

> Required before any API unit is designed. The API designs (`api` sets) cite this file instead of repeating it.

## Paths and methods

| Topic | Convention |
| --- | --- |
| Base path and version | <!-- /api/v1 --> |
| Resource names | <!-- plural nouns, lowercase, hyphenated --> |
| Methods | GET reads, POST creates or runs an action, PUT replaces, PATCH changes part, DELETE removes |
| Actions that are not CRUD | <!-- POST /invoices/{id}/close --> |

## Requests and responses

| Topic | Convention |
| --- | --- |
| Format | <!-- JSON, UTF-8 --> |
| Field names | <!-- camelCase --> |
| Dates and times | <!-- ISO 8601, UTC --> |
| Money | <!-- decimal string with currency, or integer minor units --> |
| Empty values | <!-- null is used for ...; absent means ... --> |

## Errors

| Topic | Convention |
| --- | --- |
| Error body | <!-- fields: status, code (ERR-nnnn), message, details, correlationId --> |
| Status codes | 400 malformed, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 422 rule violated, 5xx not the caller's fault |
| Messages | <!-- shown to people: no stack traces, no internals --> |

## Lists

| Topic | Convention |
| --- | --- |
| Pagination | <!-- page and size, with a maximum size --> |
| Sorting and filtering | <!-- --> |

## Versioning and compatibility

| Change | Allowed without a new version |
| --- | --- |
| Adding an optional field or an operation | yes |
| Removing or renaming a field, changing a type or a meaning | no |
