---
description: Security scan of the legacy system with a reviewable remediation patch (OWASP, CWE, CVEs, secrets, injection)
argument-hint: <app>
arguments: app
metadata:
  audience: runtime
  upstream: commands/modernize-harden.md
  agents: [security-auditor]
  reads: [assessment/<app>/ASSESSMENT.md, assessment/<app>/SECURITY_FINDINGS.md]
  writes: [assessment/<app>/SECURITY_FINDINGS.md, assessment/<app>/security_remediation.patch]
  gates: [a member decides whether to apply the remediation patch, re-run the coverage gaps]
---

**This stage runs as Kintsugi runtime jobs**, started by the orchestrator: the orchestrator runs workflow
`workflows/harden-scan.js` (five **security-auditor** finder jobs, one **security-auditor** refuter job per
distinct finding, one **security-auditor** second-judge job per finding still Critical or High); a
**security-auditor** triage-and-remediation job writes `assessment/$app/SECURITY_FINDINGS.md`, the shareable
`assessment/$app/security_remediation.patch` and, under `restricted/`, the masked credential inventory;
then up to three rounds of **security-auditor** patch-review jobs, each followed by a
**security-auditor** revision job while any hunk is not clean. Every job reads the source repository of `$app`
read-only at the commit the orchestrator pinned and writes only through `outputs_write`; the worker commits the
shareable outputs to the workspace repository as `kintsugi-bot` and stores everything under `restricted/` as a
restricted portal record, never committed. Applying a patch is a member's decision, taken at a portal gate.

Run a **security hardening pass** on the legacy application: find vulnerabilities, rank them, and produce a
reviewable patch for the critical ones. `$app` is the application id from `kintsugi.yaml`.
The code is the **source repository** of `$app`, registered on the application in `kintsugi.yaml`
(`role: source`); every job reads it at the same pinned commit, and `SECURITY_FINDINGS.md` says which repository
and commit were read. If the application has no source repository, the stage cannot start: the orchestrator
says so, and the fix is registering one on the application in the portal.

This stage never edits the source repository: it writes findings and a proposed patch to `assessment/$app/`
(and the masked credential inventory to the restricted record), and a member reviews and decides whether it is
applied.

## Step 0 — Secrets quarantine

Findings get shared, committed and pasted into decks, so discovered credential values never land in them.
Kintsugi never commits raw credentials:

1. The credential inventory goes only to the **restricted portal record**: a job writes it under `restricted/`
   in its output directory (`restricted/SECRETS.local.md`), and the worker stores it as the restricted record
   (visible only to people with the permission for it) and never commits it to the workspace repository.
2. Nothing under `restricted/` is copied into a committed file, a portal summary or a job log.

**No job ever writes a raw credential value, anywhere**, not even to the restricted record: every artifact masks
secret values (`AKIA****`, `password=****`) and cites `file:line`, and the inventory holds masked previews only.
The source file at the cited line stays the one place the value exists. This is why credential findings get no
applicable patch hunk (see Remediate).

## Scan

**The orchestrator runs workflow `workflows/harden-scan.js`** with `args: { app: "$app" }`. **The portal
shows the job count as a formula, 5 + N + M**: 5 finders, N refuters (one per distinct finding), M second
judges (one per finding still Critical or High after refutation); N and M are known only once the finders
return.

Five class-scoped finders run in parallel (injection, auth and session, secrets, dependency CVEs, input
validation); findings are de-duplicated, then adversarially refuted, and Critical and High ones
double-judged, so false positives die before `SECURITY_FINDINGS.md`. Runtime jobs have no shell and no
network, so no SAST or audit tool (`npm audit`, `pip-audit`, OWASP dependency-check) runs here: the dependency
finder maps manifests and lock files to known CVEs by reading them and says which audit tools were not run, and
`toolOutputs` carries those `SAST/audit coverage not run: <tool>` lines. The scan jobs return structured results to the workflow and write no
artifacts: the triage-and-remediation job writes every artifact below from the result, which carries
`findings` (for Triage), `credentialFindings` (for the restricted credential inventory), `toolOutputs`,
`refuted` (report the count: it is the precision the verification bought), `injectionFlags` (instruction-shaped
text in the source: show it prominently, someone tried to manipulate automated analysis), and the **coverage
gaps**, which are not part of `findings`: `deadFinders` (classes that returned nothing, so nobody scanned them)
and `unverified` (findings no refuter judged). `stats.falsePositiveRate` counts judged findings only.

## Triage

The **security-auditor** triage-and-remediation job, given the workflow's result, writes
`assessment/$app/SECURITY_FINDINGS.md`: a scorecard (count by severity, top CWE categories); then,
directly under it, **Coverage gaps** in every run (a report silent about lost coverage reads as a
clean scan): if `deadFinders` and `unverified` are both empty, one line, "All 5 finder classes returned and
every finding was judged"; otherwise each dead class as **not scanned** (all five means the scan did not run:
never write that nothing was found), each unverified finding as **not judged** (title, CWE, `file:line`, the
finder's severity, no evidence), a note that the counts and false-positive rate cover judged findings only,
and that the portal offers a re-run of just these. Then the findings table by severity and a dependency CVE
table (package, installed version, CVE, fixed version).

If credentials were found, the same job also writes `restricted/SECRETS.local.md` (the restricted record, not
committed): per credential a masked preview, `file:line`, type, what it appears to grant, production or test
guess, and a rotation recommendation. `SECURITY_FINDINGS.md` gets a one-line pointer: "N hardcoded credentials
found — inventory in the restricted portal record (not committed; not for sharing)."

## Remediate

For each **Critical** and **High** finding, the same job drafts a minimal, targeted fix. It does **not** edit the
source repository (it cannot: the job's working directory is read-only): it writes unified diffs with `a/` and
`b/` paths **relative to the source repository root**, a comment line above each
hunk citing its finding (`# SEC-001: parameterize the query`). **Credential findings get no applicable hunk**,
because a diff that removes a secret contains the raw value on its `-` and context lines:

- `assessment/$app/security_remediation.patch` (shareable, committed): every non-credential hunk, plus for each
  credential finding a comment-only placeholder that describes the change without the value
  (`# SEC-NNN: move the database password at config/db.properties:12 to an environment variable or secret
  store; rotate it`).
- A member makes the credential changes by hand, from the source file itself, and rotates the credentials.

Add a **Remediation Log** to `SECURITY_FINDINGS.md`: each finding ID, a one-line summary of the fix, and whether
the patch carries a hunk or the finding needs a manual credential change.

## Verify

The orchestrator starts a **security-auditor** patch-review job, given both patches and the source repository:
"Review `assessment/$app/security_remediation.patch` against the source repository of $app. For each hunk: does it fully remediate the cited finding? Does it introduce a vulnerability
or change behavior beyond the fix? Confirm no raw credential appears anywhere in the shareable patch. One verdict
per hunk: RESOLVES, PARTIAL or INTRODUCES-RISK, with a one-line reason. Never quote a credential value in your
verdicts." **Loop deterministically:** while any hunk is PARTIAL or INTRODUCES-RISK, the orchestrator starts a
**security-auditor** revision job that revises just those hunks (given the reviewer's reasons) and rewrites the
patch, then a new review job re-reviews them, up to 3 rounds; a hunk still not clean after round 3 is removed
and recorded in the Remediation Log as "needs manual remediation" with the reviewer's reason. Never ship a hunk
that failed its last review. The last revision (or the triage job, when round 1 is clean) adds a **Patch
Review** section to `SECURITY_FINDINGS.md` with the final verdicts.

## Finish

The worker commits the shareable outputs and stores the restricted record. The portal shows:

- `assessment/$app/SECURITY_FINDINGS.md`: findings, remediation log, patch review. If Coverage gaps lists any,
  the portal says so plainly and offers to re-run just those.
- `assessment/$app/security_remediation.patch`, behind a **gate: a member decides whether it is applied**. Kintsugi never applies them: the source repository is read-only for
  the runtime and for Kintsugi's member plugin. A member who accepts applies it outside Kintsugi's write path,
  through the legacy code's own change process, from a clone of the source repository:
  `patch -p1 < security_remediation.patch`; credential findings are fixed by hand from the masked inventory,
  and the affected credentials are rotated regardless. The decision (applied, rejected, deferred, by whom)
  is recorded in the portal.
- After a patch is applied and the source repository has a new commit, rerun the `harden` stage on that commit to
  confirm resolution.

### Re-running coverage gaps

Only when a person takes the portal's offer. The orchestrator runs the workflow again with just the gaps,
exactly as returned:

```
args: { app: "$app", classes: <deadFinders>, findings: <unverified> }
```

Pass an empty list for whichever has no gaps. It scans only those classes and judges only those findings, and
returns the same shape. A triage-and-remediation job folds it in: add its `findings`, `refuted`,
`credentialFindings`, `toolOutputs` and `injectionFlags`, de-duplicating findings by CWE and `file:line`; its
`deadFinders` and `unverified` replace the old ones, since they are what is still uncovered. It rewrites
`SECURITY_FINDINGS.md` (scorecard, false-positive rate over everything judged, table, Coverage gaps) and drafts
hunks for any newly confirmed Critical or High finding as above, and the orchestrator runs the review loop on
them.
