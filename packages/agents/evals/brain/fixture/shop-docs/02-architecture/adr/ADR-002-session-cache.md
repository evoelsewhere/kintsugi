---
id: "ADR-002"
title: "Keep user sessions in a shared Redis cache"
status: "superseded"
supersededBy: "ADR-003"
---
# ADR-002: Keep user sessions in a shared Redis cache

## Decision

The services keep each user's session in a Redis cache they all share, for eight hours after the last request.

## Why

It let the first services reuse the mainframe's notion of a terminal session without changing the clients.
