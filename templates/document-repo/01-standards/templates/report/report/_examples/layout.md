---
template: "report/report@1"
unit: "billing-web/invoices/aging-report"
---
# Aging report: layout

## Columns

| ID | Column | Source | Aggregation | Format | Rules |
| --- | --- | --- | --- | --- | --- |
| COL-01 | Customer | customer.name | none | text | - |
| COL-02 | Not yet due | invoice.total where due_date >= run date | sum | 2 decimals, right-aligned | RULE-001 |
| COL-03 | 1-30 days late | invoice.total where run date - due_date in 1..30 | sum | 2 decimals, right-aligned | RULE-001 |
| COL-04 | Over 30 days late | invoice.total where run date - due_date > 30 | sum | 2 decimals, right-aligned | RULE-001 |
| COL-05 | Total | COL-02 + COL-03 + COL-04 | sum | 2 decimals, bold | - |

## Grouping and order

| Level | Group by | Order by | Subtotal |
| --- | --- | --- | --- |
| 1 | region | region name | yes |
| 2 | customer | COL-05 descending | no |
