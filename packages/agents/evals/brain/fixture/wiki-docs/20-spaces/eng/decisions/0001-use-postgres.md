---
title: Use Postgres for all services
id: PAGE-ENG-0031
labels: [decision, database]
owner: dba-lead
status: archived
supersededBy: PAGE-ENG-0032
---

# Use Postgres for all services

## Decision

Every service stores its data in Postgres.

## Status

Replaced by [the queue decision](0002-use-queues.md) for background work only; kept for transactional data.
