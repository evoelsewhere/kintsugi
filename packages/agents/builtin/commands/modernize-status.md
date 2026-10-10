---
description: Where am I? Progress, what is stale, and the exact next step to take — start here when unsure
argument-hint: <app>
arguments: app
metadata:
  audience: portal
  upstream: commands/modernize-status.md
  agents: []
  reads: [kintsugi.yaml, assessment/<app>/, the target repository of <app>]
  writes: []
---

**The portal implements this command** as the progress view of an application. The content below is the
specification of what the portal computes and shows: the inventory, the staleness rules, the secrets-hygiene checks
and the verdict. The view inspects and never modifies; there is no report file to refresh, the portal renders the
artifacts itself. If nothing exists yet, the answer is the "start a modernization" wizard (the `modernize`
specification) for `$app`, which asks what the person wants and starts preflight.

## 1 — Inventory

Check `assessment/$app/` in the workspace repository and the target repository of `$app` (its default branch and open
member branches) and build a table, one row per stage, with each artifact's presence and last commit time (Git
history is the modification time):

| Stage | Artifacts |
|---|---|
| intent | `INTENT.md` (what the person wants; written by the "start a modernization" wizard) |
| preflight | `PREFLIGHT.md` (are the Check 0 human answers and the Check 6 scope-boundary finding there?), the registered source repository and the commit preflight read (is it still registered and reachable?) |
| assess | `ASSESSMENT.md`, `ARCHITECTURE.mmd` |
| map | `topology.json`, `*.mmd`, `extract_topology.*` |
| extract-rules | `BUSINESS_RULES.md`, `DATA_OBJECTS.md` |
| review | `RULE_REVIEWS.json`: how many flagged rules a person has decided (confirmed, wrong, needs discussion), and how many are still open |
| brief | `MODERNIZATION_BRIEF.md` (is the approval gate decided, and the approval block signed?) |
| harden | `SECURITY_FINDINGS.md`, `security_remediation.patch` |
| uplift | `DELTA_CATALOG.md`, `BASELINE.md`, `PLAYBOOK.md` (no playbook means the pilot has not happened, so the fan-out must not), `UPLIFT_NOTES.md` in the target repository (per unit: builds on target? baseline reproduced?) |
| transform | each module in the target repository: tests present? `TRANSFORMATION_NOTES.md` present (its completion marker)? |
| reimagine | the reimagined target repository: per-service acceptance tests, and the `CLAUDE.md` handoff (its completion marker; it does not write `TRANSFORMATION_NOTES.md`) |
| equivalence | the latest `runs/<module>/<run-id>/EQUIVALENCE.json` per module: cases executed, same, differs (any differing or missing case, or zero executed, is a failure) |
| verify | `VERIFICATION.md` (written by the `verify` stage): the verdict per built module (PROVEN, PARTLY PROVEN or NOT PROVEN) and whether a person has signed it. A built module with no `VERIFICATION.md`, or one older than the module's code or tests, is **not proven yet** |

## 2 — Stale

Flag any artifact older than one it derives from: the brief older than `ASSESSMENT.md`, `topology.json` or
`BUSINESS_RULES.md` (no longer reflects discovery: rerun `brief`); an uplift's brief older than
`DELTA_CATALOG.md`, or with no catalog (phase order was decided without the version deltas: rerun `brief`);
discovery artifacts (`ASSESSMENT.md`, `topology.json`, `BUSINESS_RULES.md`) that read an older source commit than
the one now on the source repository's default branch (the legacy code moved on: say how many commits behind, and
rerun the stage if the change touches its scope); a `TRANSFORMATION_NOTES.md` older
than `BUSINESS_RULES.md` (the module may not implement the latest rules: list which).

## 3 — Secrets hygiene

Kintsugi never commits raw credentials: the credential inventory is a restricted portal record, and
`SECURITY_FINDINGS.md` keeps masked previews and points to it. Check that this held: no `SECRETS.local.md` and no
`*.local.patch` file is tracked anywhere in the workspace repository, and none was ever committed (search the
workspace repository's full history for those paths: it should be empty). Check that `SECURITY_FINDINGS.md` shows
only masked previews. If any check fails, say so prominently and recommend rotation of the exposed credentials and
history scrubbing.

## 4 — Verdict

End with three lines:

- **Where you are:** the furthest completed stage and how much it covers ("mapped 100%, 2 of 14 modules transformed, 1 proven").
- **What is stale:** or "nothing".
- **Next step:** the single most useful next step as one action (a stage to start, a portal task to answer, a gate to
  decide, or the exact member command to run, e.g. `/kintsugi:modernize-brief billing`), with a one-line reason.
  The order is preflight, assess, map, extract-rules, review (when rules are flagged for a person), brief (needs approval), then the brief's Phase 1 command
  (`transform`, `uplift` or `reimagine`), then `verify` for what was built, then `harden`. Never call a
  built module done until `verify` says PROVEN and a person has signed it: put `verify` ahead of building the next module.
