---
description: Confirm or correct the business rules that need a person's judgement; the plan and the build read your answers
argument-hint: <app> [flagged|p0|all]
arguments: app scope
metadata:
  audience: portal
  upstream: commands/modernize-review.md
  agents: []
  reads: [assessment/<app>/BUSINESS_RULES.md, assessment/<app>/RULE_REVIEWS.json, assessment/<app>/MODERNIZATION_BRIEF.md]
  writes: [assessment/<app>/RULE_REVIEWS.json, assessment/<app>/RULE_REVIEWS.md]
  gates: [a person decides each flagged rule as right or wrong or not sure]
---

**The portal implements this command** as its rule review screen. The content below is the specification of what
the screen asks and records. The person's answers are written by the worker on their behalf: it commits
`RULE_REVIEWS.json` and `RULE_REVIEWS.md` to the workspace repository as `kintsugi-bot`, with a
`Kintsugi-Actor: <user>` trailer naming the reviewer.

Ask a person to decide the business rules in `assessment/$app/BUSINESS_RULES.md` that depend on judgement, and record each answer so the plan and the build honor it. Agents mined the rules and a second agent checked every citation, but only someone who knows the business can say whether a rule is *right*: whether a truncation is intended or a defect, whether a threshold is still the policy. This screen asks in the portal and never edits `BUSINESS_RULES.md`.

## 1 — Choose the rules

Read `BUSINESS_RULES.md` (each card has `### RULE-NNN`, Priority, Confidence, and sometimes a suspected defect or an SME question) and, if it exists, `assessment/$app/RULE_REVIEWS.json`; rules already decided are skipped, and the screen says how many. `$scope` picks the rest:

- **flagged** (the default): P0 rules that have a suspected defect, an SME question or less than High confidence, plus any rule the brief's open questions name.
- **p0**: every P0 rule. **all**: every rule.

Say how many rules will be asked (about a minute per ten). If none is left, say so and name the next step.

## 2 — Ask

Ask in the portal as structured choices, never as free chat text, one card per rule (the screen may group a few per page). One question per rule: its id as the header; the title, the plain-English statement, its Given/When/Then in one line, the cited lines (`file:line`, linked to the source repository at the commit the rules were extracted from) and the suspected defect or SME question if it has one as the question; and three options: **Right** (the rule is correct and wanted), **Wrong, or not wanted** (it misdescribes the code, or the code does this today but should not), **Not sure** (needs a discussion). The person can type a note instead of choosing: what is right, or the question that needs answering. Keep it, in their words. Stop when they say to: undecided rules stay open as a portal task. Verdicts given through the API in one request (`RULE-004 wrong: it truncates on purpose`) are recorded as given, with no card for those rules. Without a person and without given verdicts (an automated run) do not guess: leave every rule unreviewed and say so.

## 3 — Record

The worker merges the answers into `assessment/$app/RULE_REVIEWS.json`, the one record of rule verdicts (the portal's review deck and this screen write the same file):

```json
{ "app": "<app id>", "version": 1, "reviews": {
    "RULE-004": { "verdict": "confirmed", "at": "<ISO time>", "by": "<user>", "title": "<the rule's title>", "note": "<their words, optional>" } } }
```

`verdict` is `confirmed` (Right), `wrong` (Wrong, or not wanted) or `discuss` (Not sure). Change an earlier entry only when a new answer replaces it. The worker writes `assessment/$app/RULE_REVIEWS.md` from it: a short paragraph, then a table `Rule | Verdict | When | Title | Note`, sorted by rule number. Both land in one commit with the `Kintsugi-Actor` trailer. The portal shows the updated verdicts right away; there is no report to refresh.

## 4 — What happens next

Tell the person, in three lines: rules marked wrong or needing discussion are not settled; `brief` lists them as open questions and never builds a Behavior Contract on them; `transform` and `reimagine` will not pin a wrong rule as the oracle and stop on a P0 rule still under discussion. Then the next step: the `brief` stage (`/kintsugi:modernize-brief $app` in the architect's harness; run it again if the brief exists and any rule changed), or the brief's next build stage when the plan is already approved.
