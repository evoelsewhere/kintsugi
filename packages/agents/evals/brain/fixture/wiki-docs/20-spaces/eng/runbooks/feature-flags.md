---
title: Feature flags
id: PAGE-ENG-0027
labels: [runbook, sev3, config]
owner: platform-lead
---

# Feature flags

## Symptoms

The feature flags stops answering and the health check fails.

## Steps

1. Restart the feature flags with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the platform-lead if it does not recover.
