---
template: "api/api@2"
unit: "billing-api/invoices/invoice-api"
---
# Invoice API: operations

## Operations

| ID | Method | Path | Summary | Rules | Auth |
| --- | --- | --- | --- | --- | --- |
| API-001 | GET | /invoices | Search invoices by customer and period, 20 per page | RULE-001 | billing role |
| API-002 | GET | /invoices/{id} | Read one invoice with its lines | - | billing role |
| API-003 | POST | /invoices/{id}/close | Close an open invoice | RULE-002 | billing admin |

## Requests

| Operation | Field | In | Type | Required | Constraints |
| --- | --- | --- | --- | --- | --- |
| API-001 | customerId | query | string | no | 1-12 digits; at least one of customerId and period is required |
| API-001 | period | query | string | no | YYYY-MM |
| API-001 | page | query | integer | no | from 1; default 1 |
| API-003 | id | path | string | yes | an existing invoice |

## Responses

| Operation | Status | Field | Type | Notes |
| --- | --- | --- | --- | --- |
| API-001 | 200 | items[] | array | up to 20 invoices; each has id, customerId, period, total |
| API-001 | 200 | total | integer | invoices that match, across all pages |
| API-003 | 204 | - | - | no body |

## Errors

| Operation | Status | Code | Condition | Message |
| --- | --- | --- | --- | --- |
| API-001 | 422 | ERR-0001 | customerId and period are both missing | Enter a customer or a period. |
| API-003 | 409 | ERR-0002 | the invoice is already closed | The invoice is already closed. |
