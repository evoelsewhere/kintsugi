---
title: Payment outage
id: PAGE-ENG-0011
labels: [runbook, sev1, payments]
owner: payments-lead
---

# Payment outage

## Symptoms

Checkout returns the error `PAY-503` and the payment gateway dashboard shows failed charges.

## Steps

1. Check the gateway status page.
2. Fail over to the secondary gateway with the `gateway-switch` command.
3. Tell the support desk to expect refunds. See the [incident report template](../_templates/incident-report.md).

> [!WARNING]
> Do not fail over while a refund batch is running.

## Rollback

Switch back after the gateway reports twenty clean minutes.
