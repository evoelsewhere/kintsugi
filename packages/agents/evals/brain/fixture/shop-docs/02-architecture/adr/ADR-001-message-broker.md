---
id: "ADR-001"
title: "Use a managed Kafka service as the message broker"
status: "accepted"
---
# ADR-001: Use a managed Kafka service as the message broker

## Context

The services exchange events, and the order flow must survive the loss of one service for an hour.

## Decision

The services exchange events through a managed Kafka service, with one topic per event type, kept for seven days.

## Why

It is the only broker the operations team already runs in production, and seven days of events let the team replay a day of orders after a failure.
