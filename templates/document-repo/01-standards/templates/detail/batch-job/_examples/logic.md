---
template: "detail/batch-job@1"
unit: "billing-web/invoices/close-period"
---
# Close period: batch job logic

## Schedule and inputs

| Item | Value | Notes |
| --- | --- | --- |
| Schedule | 0 2 1 * * | The first day of each month at 02:00 |
| Reads | invoice (status = OPEN, period = previous month) | About 400,000 rows |
| Parameter | period | Defaults to the previous month; a rerun passes it |

## Steps

| Step | Action | Function | Commit unit |
| --- | --- | --- | --- |
| 1 | Lock the period so no invoice can be added to it | F-001 | once |
| 2 | Total each customer's open invoices into the statement table | F-002 | every 1,000 customers |
| 3 | Mark the invoices CLOSED | F-003 | with step 2 |

## Business rules

| Rule | Logic | Function |
| --- | --- | --- |
| RULE-001 | An invoice is closed only when the customer's statement total equals the sum of its lines | F-002 |

## Restart and error handling

| Code | Condition | Message | Restart |
| --- | --- | --- | --- |
| ERR-0001 | A statement total differs from the sum of its lines | Statement total mismatch for customer {id} | Resumes at the failed customer; earlier customers are not redone |

## Common components used

| Component | Use |
| --- | --- |
| COM-LOG-01 | One audit record per closed period |

## Test cases

| Case | Rule | Input | Expected |
| --- | --- | --- | --- |
| T-001 | RULE-001 | one invoice with a line total of 100 and a statement total of 90 | ERR-0001 is logged and the invoice stays OPEN |
