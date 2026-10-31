---
status: "understood"
rules: 3
---
# Backorder creation

How an order line becomes a backorder.

## Business rules

### RULE-BKO01-0001: Backorder trigger

An order line without stock becomes a backorder when the supplier confirms a date.

### RULE-BKO01-0002: Backorder date

The customer sees the supplier date plus two days.

### RULE-BKO01-0003: Backorder limit

A customer may hold at most 10 backorder lines.
