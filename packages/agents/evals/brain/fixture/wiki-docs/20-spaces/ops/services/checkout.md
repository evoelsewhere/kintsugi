---
title: Checkout service
id: PAGE-OPS-0011
labels: [inventory, payments]
owner: payments-lead
---

# Checkout service

## Owner

The payments team owns the checkout service.

## Dependencies

Checkout calls the payment gateway and the price endpoint. When the gateway fails, follow the
[payment outage](../../eng/runbooks/payment-outage.md) runbook.

## Children

```kintsugi-children
depth: 1
```
