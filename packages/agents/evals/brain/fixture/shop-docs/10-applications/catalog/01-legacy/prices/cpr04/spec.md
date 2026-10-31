---
status: "understood"
rules: 3
---
# Price endings

How a computed price is turned into the price shown.

## Business rules

### RULE-CPR04-0001: Kept endings

A computed price that already ends in .99 is shown as it is.

### RULE-CPR04-0002: Other endings

Any other computed price is shown at the nearest multiple of 0.05.

### RULE-CPR04-0003: Ending ties

A computed price exactly halfway between two multiples of 0.05 goes to the higher one.
