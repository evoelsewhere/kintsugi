---
template: "test@2"
unit: "billing-web/invoices/search-invoices"
---
# Search invoices: test cases

## Cases

| Rule | ID | Level | Target | Preconditions | Input | Expected |
| --- | --- | --- | --- | --- | --- | --- |
| RULE-001 | TC-001 | ut | EVT-002 | none | Customer empty, Period empty, click Search | ERR-0001 "Enter a customer or a period." is shown and no query runs |
| RULE-001 | TC-002 | it | EVT-002 | customer 1001 has 3 invoices in 2026-09 | Customer 1001, Period empty, click Search | Results lists the 3 invoices, newest first |
| RULE-002 | TC-003 | st | EVT-003 | invoice 5001 exists | click the row of invoice 5001 | the invoice screen opens on invoice 5001 |

## Boundary and failure cases

| ID | Rule | Target | Scenario | Expected |
| --- | --- | --- | --- | --- |
| TC-004 | RULE-001 | EVT-002 | Customer is 13 characters long | ERR-0002 is shown; the field keeps its value |
| TC-005 | RULE-001 | EVT-002 | the invoice query times out after 30 seconds | the screen shows ERR-0003 and stays usable |
