---
id: "ADR-003"
title: "Keep no session state in the services"
status: "accepted"
supersedes: "ADR-002"
---
# ADR-003: Keep no session state in the services

## Decision

The services keep no session state: every request carries a signed token, which expires 15 minutes after it is issued and is renewed by the client.

## Why

A shared cache made every service depend on one store, and the security review refused sessions that outlive a working day.
