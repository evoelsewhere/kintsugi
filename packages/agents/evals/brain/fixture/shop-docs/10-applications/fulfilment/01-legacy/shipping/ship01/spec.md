---
status: "understood"
rules: 3
---
# Delivery promise

How the delivery date shown at checkout is computed.

## Business rules

### RULE-SHP01-0001: Promise cut-off

An order placed before 14:00 leaves the warehouse the same day.

### RULE-SHP01-0002: Promise weekend

No parcel leaves the warehouse on Sunday.

### RULE-SHP01-0003: Promise buffer

The promised date adds one day to the carrier's own estimate.
