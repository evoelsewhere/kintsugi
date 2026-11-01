---
title: Session store
id: PAGE-ENG-0024
labels: [runbook, sev3, identity]
owner: identity-lead
---

# Session store

## Symptoms

The session store stops answering and the health check fails.

## Steps

1. Restart the session store with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the identity-lead if it does not recover.
