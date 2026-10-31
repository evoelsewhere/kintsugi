---
id: "COM-LOG-01"
title: "Structured logging"
---
# COM-LOG-01: Structured logging

The component every service logs through.

## Format

Each entry is one JSON object per line, with the fields `time`, `level`, `service`, `traceId` and `message`.

## Retention

Logs are kept for 30 days, then deleted.
