---
title: Search service
id: PAGE-ENG-0020
labels: [runbook, sev3, search]
owner: search-lead
---

# Search service

## Symptoms

The search service stops answering and the health check fails.

## Steps

1. Restart the search service with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the search-lead if it does not recover.
