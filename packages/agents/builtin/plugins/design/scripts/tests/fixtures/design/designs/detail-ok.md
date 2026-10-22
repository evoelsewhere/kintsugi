---
template: "detail@2"
unit: "billing/payroll/run-period"
---
# Run period: logic

## Business rules

| Rule | Logic | Function |
| --- | --- | --- |
| R-001 | Sum the lines | F-001 |
| R-002 | Round half up | F-001 |
| R-003 | ISO date | F-002 |

## Error handling

| Code | Condition | Message |
| --- | --- | --- |
| ERR-0001 | Period closed | The period is closed |

## Dependencies

| Component | Use |
| --- | --- |
| COM-LOG-01 | Audit log |
