---
title: "Technology stack"
status: "draft"
version: 1
---
# Technology stack

The technology chosen for each concern, with the reason and the record that decided it. A unit's design uses only what is listed here; adding to this list is an architecture decision.

## Stack

| Concern | Choice | Version | Reason | Decision |
| --- | --- | --- | --- | --- |
| Language and runtime | <!-- e.g. Java --> | <!-- 21 LTS --> | <!-- why this one --> | `adr/<number>-<title>.md` |
| Application framework | <!-- --> | <!-- --> | <!-- --> | <!-- --> |
| UI | <!-- framework and UI kit --> | <!-- --> | <!-- --> | <!-- --> |
| Database | <!-- engine --> | <!-- --> | <!-- --> | <!-- --> |
| Messaging | <!-- broker or none --> | <!-- --> | <!-- --> | <!-- --> |
| Build and package | <!-- --> | <!-- --> | <!-- --> | <!-- --> |
| Test | <!-- unit, integration, end-to-end tools --> | <!-- --> | <!-- --> | <!-- --> |
| Observability | <!-- logs, metrics, traces --> | <!-- --> | <!-- --> | <!-- --> |

## Standard libraries

Libraries every component may use without asking; anything else needs an ADR.

| Library | Purpose | Component |
| --- | --- | --- |
| <!-- name --> | <!-- what it is for --> | <!-- all or a component --> |

## Not used

What was considered and refused, so it is not proposed again.

| Option | Why not | Record |
| --- | --- | --- |
| <!-- --> | <!-- --> | <!-- --> |

## Support and lifecycle

| Technology | Supported until | Upgrade policy |
| --- | --- | --- |
| <!-- --> | <!-- date --> | <!-- how and when it is upgraded --> |
