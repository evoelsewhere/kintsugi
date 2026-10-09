---
name: app-assessment
description: Score one legacy application on the Kintsugi transformation scorecard and recommend a 7R disposition with evidence. Use for the assessment runtime agent in the Discover & Assess phase.
---

# Application assessment

## Inputs
- Application inventory record (`inventory.get`), AS-IS KB (`kb.search`, `kb.graph`), read-only source tree.

## Steps
1. Gather evidence per criterion group: business, technical, feasibility, cost, risk (`ScorecardCriterion` in `packages/domain`).
2. Technical and feasibility evidence comes from code and KB: framework/runtime versions and EOL, dependency count and coupling, test presence, code-quality signals, integration points.
3. Business and cost evidence that is not in the sources must be marked `NEEDS-INPUT` — never guess.
4. Score each criterion 1–10 with a one-line justification and citations (`path:line`, KB doc id).
5. Compute the weighted total, map it to priority and candidate dispositions, then recommend one disposition and explain the trade-off against the runner-up.
6. Write the result to `/out/assessment/<app>/scorecard.md`; Kintsugi commits it to the workspace repo as a PR for architect review. It is a draft, not a decision.
