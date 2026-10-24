---
title: "Quality attributes"
status: "draft"
version: 1
---
# Quality attributes

How well the target must work, as numbers that can be checked. "Fast" and "reliable" are not requirements here: each row names a measure, a target and how it is verified. The units' test cases and the review rules cite the ids.

## Targets

| Id | Attribute | Measure | Target | Scope | Verified by |
| --- | --- | --- | --- | --- | --- |
| Q-01 | Performance | <!-- 95th percentile response time of a search --> | <!-- under 1 s at 200 concurrent users --> | <!-- screens and APIs --> | <!-- load test --> |
| Q-02 | Throughput | <!-- invoices closed per hour by the period-close batch --> | <!-- 400,000 per run, within the window --> | <!-- batch jobs --> | <!-- rehearsal on production-sized data --> |
| Q-03 | Availability | <!-- uptime in business hours --> | <!-- 99.9% per month --> | <!-- the system --> | <!-- monitoring --> |
| Q-04 | Recoverability | <!-- recovery time and recovery point --> | <!-- 4 h and 15 min --> | <!-- the data stores --> | <!-- restore drill --> |
| Q-05 | Scalability | <!-- growth the design must absorb --> | <!-- 3x users and 5x data in 3 years --> | <!-- components --> | <!-- capacity test --> |
| Q-06 | Security | <!-- findings open at release --> | <!-- no critical or high --> | <!-- all components --> | <!-- scan and review --> |
| Q-07 | Maintainability | <!-- test coverage of business rules --> | <!-- every rule has a test case --> | <!-- all units --> | <!-- review rule --> |
| Q-08 | Usability and accessibility | <!-- standard met --> | <!-- WCAG 2.2 AA --> | <!-- screens --> | <!-- audit --> |

## Priorities

When two attributes conflict, the one listed first wins; say why, so a designer does not decide again.

| Order | Attribute | Reason |
| --- | --- | --- |
| 1 | <!-- --> | <!-- --> |

## Scenarios

The few situations the architecture is judged on, written as stimulus and response.

| Id | Stimulus | Environment | Expected response | Attribute |
| --- | --- | --- | --- | --- |
| S-01 | <!-- the period-close batch fails at 60% --> | <!-- month end --> | <!-- it resumes without redoing finished customers --> | Q-04 |

## Verification

| Attribute | When it is verified | By whom | Evidence is kept in |
| --- | --- | --- | --- |
| <!-- performance --> | <!-- before each wave goes live --> | <!-- team --> | <!-- the test report of the wave --> |
