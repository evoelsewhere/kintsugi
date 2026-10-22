---
template: "detail/screen@1"
unit: "billing-web/invoices/search-invoices"
---
# Search invoices: screen logic

## Layout

| Item | Type | Source | Notes |
| --- | --- | --- | --- |
| Customer | text input | the user | Optional; at least one of customer and period is required |
| Period | month picker | the user | Defaults to the current month |
| Results | table | invoice list | 20 rows per page; the total is right-aligned in the customer's currency |

## Events

| Event | Trigger | Handler | Rule |
| --- | --- | --- | --- |
| Search | click Search | F-001 | RULE-001 |
| Open invoice | click a row | F-002 | - |

## Business rules

| Rule | Logic | Function |
| --- | --- | --- |
| RULE-001 | When neither customer nor period is filled, the search is refused with ERR-0001 | F-001 |

## Messages and errors

| Code | Condition | Message |
| --- | --- | --- |
| ERR-0001 | Customer and period are both empty | Enter a customer or a period. |

## Common components used

| Component | Use |
| --- | --- |
| COM-AUTH-01 | Only users with the billing role can open the screen |

## Test cases

| Case | Rule | Input | Expected |
| --- | --- | --- | --- |
| T-001 | RULE-001 | customer empty, period empty | ERR-0001 is shown and no query runs |
