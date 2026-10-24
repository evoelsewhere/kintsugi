---
title: "Portfolio scorecard"
status: "draft"
version: 1
---
# Portfolio scorecard

One row per application: the assessment in numbers, the risks, the value of migrating it and the resulting priority. Decided at gate G1. The scores come from the application's assessment (`10-applications/<app>/01-legacy/assessment.md`) and the criteria below.

## Criteria

| Criterion | Weight | Scale | Source |
| --- | --- | --- | --- |
| Business value | <!-- 30% --> | 1 (low) to 5 (high) | <!-- sponsor --> |
| Technical risk | <!-- 25% --> | 1 (low) to 5 (high) | <!-- the assessment --> |
| Size and complexity | <!-- 20% --> | 1 (small) to 5 (large) | <!-- the inventory --> |
| Dependency on other systems | <!-- 15% --> | 1 (isolated) to 5 (entangled) | <!-- the topology --> |
| Urgency (end of support, regulation) | <!-- 10% --> | 1 (none) to 5 (immediate) | <!-- sponsor --> |

## Scores

| Application | Value | Risk | Size | Dependency | Urgency | Weighted score | Priority | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <!-- billing-web --> | <!-- 4 --> | <!-- 3 --> | <!-- 3 --> | <!-- 2 --> | <!-- 4 --> | <!-- 3.4 --> | <!-- 1 --> | rebuild / rehost / retire / keep |

## Notes per application

<!-- One short paragraph per application: what drives its score, the risks that matter, the KPI it moves most. -->
