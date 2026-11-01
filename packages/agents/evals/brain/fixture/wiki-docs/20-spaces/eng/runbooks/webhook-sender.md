---
title: Webhook sender
id: PAGE-ENG-0025
labels: [runbook, sev3, integration]
owner: integration-lead
---

# Webhook sender

## Symptoms

The webhook sender stops answering and the health check fails.

## Steps

1. Restart the webhook sender with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the integration-lead if it does not recover.
