---
title: Report builder
id: PAGE-ENG-0023
labels: [runbook, sev3, reporting]
owner: data-lead
---

# Report builder

## Symptoms

The report builder stops answering and the health check fails.

## Steps

1. Restart the report builder with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the data-lead if it does not recover.
