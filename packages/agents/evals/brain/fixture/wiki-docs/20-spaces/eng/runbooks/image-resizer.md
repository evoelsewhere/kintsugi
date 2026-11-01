---
title: Image resizer
id: PAGE-ENG-0022
labels: [runbook, sev3, media]
owner: media-lead
---

# Image resizer

## Symptoms

The image resizer stops answering and the health check fails.

## Steps

1. Restart the image resizer with the `svc-restart` command.
2. Watch the queue depth for ten minutes.
3. Escalate to the media-lead if it does not recover.
