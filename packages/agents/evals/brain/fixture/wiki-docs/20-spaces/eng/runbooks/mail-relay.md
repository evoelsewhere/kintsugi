---
title: Mail relay
id: PAGE-ENG-0021
labels: [runbook, sev3, mail]
owner: comms-lead
---

# Mail relay

## Symptoms

The mail relay stops answering and the health check fails.

## Steps

1. Restart the mail relay with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the comms-lead if it does not recover.
