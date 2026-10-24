---
title: "Testing conventions"
status: "draft"
version: 1
---
# Testing conventions

> Required before the first unit is built. The test designs (the `test` set) and the reviewers follow this file.

## Levels

| Level | Code | What it proves | Runs | Where |
| --- | --- | --- | --- | --- |
| Unit | ut | one rule or function in isolation | on every commit | developer machine, CI |
| Integration | it | components with their real neighbours (database, queue) | on every merge request | CI |
| System | st | a user-visible flow end to end, against the legacy behaviour | before a wave goes live | staging |

## Coverage

| Rule | Requirement |
| --- | --- |
| Business rules | every rule of a unit has at least one test case, and the case cites the rule id |
| Boundaries | every limit a rule states is tested at, just below and just above |
| Failures | every error code of the design is raised by at least one test |

## Naming and layout

| Thing | Convention |
| --- | --- |
| Test files | <!-- next to the code, or under tests/ --> |
| Test names | <!-- <rule id>_<scenario>_<expected> --> |
| Case ids | `TC-nnn` as written in the unit's test design |

## Test data

| Topic | Convention |
| --- | --- |
| Source | synthetic or masked copy; never production data as it is |
| Setup and cleanup | each test builds what it needs and removes it; tests run in any order |
| Fixtures | <!-- where they live and how they are versioned --> |

## Parity with the legacy system

| Check | How |
| --- | --- |
| Same input, same output | <!-- replay recorded legacy input and compare --> |
| Differences | every accepted difference is an ADR, cited by the test |
