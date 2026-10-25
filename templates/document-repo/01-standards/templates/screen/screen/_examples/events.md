---
template: "screen/screen@1"
unit: "billing-web/invoices/search-invoices"
---
# Search invoices: events and validations

## Events

| ID | Event | Trigger | Action | Rule | Outcome |
| --- | --- | --- | --- | --- | --- |
| EVT-001 | Load | the screen opens | set Period to the current month; leave Customer empty | - | the form is shown, Results is empty |
| EVT-002 | Search | click Search | check VAL-001, then read invoices of the customer in the period, 20 per page | RULE-BILL01-0001 | Results shows the page, or "no invoices found" |
| EVT-003 | Open invoice | click a row of Results | go to the invoice screen with the invoice id | - | the invoice is shown |

## Validations

| ID | Item | Check | Condition | Message | Rule |
| --- | --- | --- | --- | --- | --- |
| VAL-001 | ITM-001 | on submit | Customer and Period are both empty | ERR-0001 | RULE-BILL01-0001 |

## Messages

| Code | Severity | Text |
| --- | --- | --- |
| ERR-0001 | error | Enter a customer or a period. |
| INF-0001 | info | No invoices found. |
