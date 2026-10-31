# Coexistence

How the old batch and the new services run side by side until the batch is switched off.

## Period

Both systems run in parallel for 45 days after pricing goes live. The batch remains the system of record until the last day.

## Reconciliation

Every night a job compares the invoices of both systems and reports any difference above 0.01.
