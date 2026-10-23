---
template: "detail/screen@2"
unit: "billing/payroll/run-period"
---
# Run period: screen logic

## Business rules

| Rule | Logic | Function |
| --- | --- | --- |
| R-001 | Sum the lines | F-001 |
| R-002 | Round half up | F-001 |
| R-003 | ISO date | F-002 |

## Screen events

| Event | Handler | Rule |
| --- | --- | --- |
| Click Save | save() through COM-LOG-01 | R-001 |
| Click Close | close() | R-002 |
