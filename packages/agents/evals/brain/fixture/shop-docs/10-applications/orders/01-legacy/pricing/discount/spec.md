---
status: "understood"
rules: 3
---
# Discount

How the legacy pricing batch computes the discount of an order.

## Business rules

### RULE-PRC01-0001: Gold tier discount

A customer of the gold tier gets 10% off the order subtotal.

### RULE-PRC01-0002: Loyalty discount

A customer with more than 24 months of orders gets an extra 3% off, applied after the tier discount.

### RULE-PRC01-0003: Discount cap

The total discount of an order never exceeds 15% of its subtotal.

## Gaps and questions

| ID | Kind | Question | Where | Impact |
| --- | --- | --- | --- | --- |
| GAP-PRC01-0001 | unresolved | Which tier applies to a customer who changed tier during the month? | `PRCDISC.cbl` | risk |
