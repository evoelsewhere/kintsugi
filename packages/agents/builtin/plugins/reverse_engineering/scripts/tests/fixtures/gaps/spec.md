# tax/calc

## Purpose

Rounds the tax of an invoice.

## Gaps and questions

| ID | Kind | Question | Where | Impact | Settled by | Probe |
| --- | --- | --- | --- | --- | --- | --- |
| `GAP-tax.calc-03` | unverified | Is the rounding covered by tests? No test tree was provided. | `legacy/src/TAX.cbl:1` | note |  |  |
| GAP-tax.calc-01 | missing-source | What does copybook TAXTAB hold? It is COPYed but is in no repository. | `legacy/src/TAX.cbl:41` | blocking | source-owner | Ask the owners of the copybook library for TAXTAB. |
| GAP-tax.calc-02 | ambiguous | Why is the rate 0.0825 and not 0.08? A comment says 8%. | RULE-tax.calc-01 | risk | finance team | Ask the tax team which rate applies. |
| GAP-tax.calc-02 | ambiguous | Listed twice: ignored. | RULE-tax.calc-01 | risk |  |  |
| NOTE-1 | note | Not a gap id: ignored. | - | note |  |  |

## Source references

- `legacy/src/TAX.cbl`
