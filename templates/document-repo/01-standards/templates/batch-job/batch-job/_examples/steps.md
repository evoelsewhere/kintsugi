---
template: "batch-job/batch-job@1"
unit: "billing-web/invoices/close-period"
---
# Close period: steps

## Steps

| ID | Action | Reads | Writes | Rules | Commit unit |
| --- | --- | --- | --- | --- | --- |
| STEP-01 | Lock the period so no invoice can be added to it | period | period.status = LOCKED | - | once |
| STEP-02 | Total each customer's open invoices into the statement table | invoice (status = OPEN, period) | statement | RULE-BILL01-0001 | every 1,000 customers |
| STEP-03 | Mark the invoices of a customer CLOSED | invoice | invoice.status = CLOSED | RULE-BILL01-0001 | with STEP-02 |

## Restart and error handling

| Code | Step | Condition | Message | Restart |
| --- | --- | --- | --- | --- |
| ERR-0001 | STEP-02 | a statement total differs from the sum of its lines | Statement total mismatch for customer {id} | resumes at the failed customer; earlier customers are not redone |
| ERR-0002 | STEP-01 | the period is already locked by another run | Period {period} is already being closed | nothing to redo; wait for the other run |

## Common components used

| Component | Use |
| --- | --- |
| COM-LOG-01 | one audit record per closed period |
