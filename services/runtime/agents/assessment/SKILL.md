---
name: app-assessment
description: Score one legacy application on the Kintsugi transformation scorecard and recommend a 7R disposition with evidence. Used by the built-in assessment runtime agent in the Discover & Assess phase.
---

# Application assessment

## Inputs
- Application entry in `kintsugi.yaml` and its unit files (`units/<app>/**`).
- AS-IS KB (`kb.search`).
- The read-only source tree at `/src`, read directly with file tools.

## Steps
1. Gather evidence per criterion group: business, technical, feasibility, cost, risk (`ScorecardCriterion` in `packages/domain`).
2. Technical and feasibility evidence comes from reading the code and the KB:
   - framework / runtime versions and end of life;
   - dependencies and coupling you can see;
   - test presence;
   - code-quality signals;
   - integration points.

   Kintsugi has no code graph, so state how you found each dependency.
3. Business and cost evidence that is not in the sources must be marked `NEEDS-INPUT`. Never guess.
4. Score each criterion 1–10, with a one-line justification and citations (`path:line`, KB document).
5. Compute the weighted total and map it to a priority and candidate dispositions. Recommend one disposition and explain the trade-off against the runner-up.
6. If units are missing for the application, propose them: write unit files (kind from the pack's `units.kinds`, `source` paths, `dependsOn` as you understand it) to `/out/units/<app>/`.
7. Write the scorecard to `/out/assessment/<app>/scorecard.md`. Kintsugi commits everything as a PR for architect review. It is a draft, not a decision.
