---
title: Batch scheduler
id: PAGE-ENG-0026
labels: [runbook, sev3, batch]
owner: batch-lead
---

# Batch scheduler

## Symptoms

The batch scheduler stops answering and the health check fails.

## Steps

1. Restart the batch scheduler with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the batch-lead if it does not recover.
