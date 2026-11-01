---
title: Database failover
id: PAGE-ENG-0013
labels: [runbook, sev1, database]
owner: dba-lead
---

# Database failover

## Symptoms

Writes fail with `read-only transaction` and the primary is unreachable.

## Steps

1. Confirm the replica lag is under thirty seconds.
2. Promote the replica with the `db-promote` command.
3. Point the services at the new primary.

## Follow-up

File an [incident report](../_templates/incident-report.md) within a day. See also the
[postgres decision](../decisions/0001-use-postgres.md).
