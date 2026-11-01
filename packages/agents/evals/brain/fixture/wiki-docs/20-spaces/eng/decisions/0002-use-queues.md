---
title: Use a queue for background work
id: PAGE-ENG-0032
labels: [decision, queues]
owner: platform-lead
---

# Use a queue for background work

## Decision

Background work goes through the job queue, never through a cron hidden in a service.

## Consequences

Retries and the dead letter list become visible to everyone.
