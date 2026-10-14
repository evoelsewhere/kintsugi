---
description: What am I dealing with? Inventory, complexity, debt, security and a recommended modernization pattern
argument-hint: <app> | --portfolio
arguments: app
metadata:
  audience: runtime
  upstream: commands/modernize-assess.md
  agents: [legacy-analyst, security-auditor]
  skills: [mermaid-diagrams]
  reads: [standards/, kintsugi.yaml, assessment/<app>/INTENT.md, assessment/<app>/telemetry/, assessment/<app>/graph/, assessment/<app>/catalog.json, knowledge/as-is/<app>/units.json, units/<app>/]
  writes: [assessment/<app>/inventory.json, assessment/<app>/tools/extract_topology.py, assessment/<app>/topology.json, assessment/<app>/catalog.json, assessment/<app>/ASSESSMENT.md, assessment/<app>/ARCHITECTURE.mmd, assessment/portfolio.md, assessment/portfolio.json]
  flow:
    - script: inventory
    - parallel:
        - agent: legacy-analyst
          as: structure
        - agent: legacy-analyst
          as: debt
        - agent: security-auditor
          as: security
    - agent: legacy-analyst
      as: topology script
    - script: extract_topology
      generated: true
      repair: legacy-analyst
    - script: catalog_from_topology
    - agent: legacy-analyst
      as: curate the catalog
    - script: apply_catalog_edits
    - script: reconcile_catalog
    - agent: legacy-analyst
      as: synthesis
---

**This stage runs as Kintsugi runtime jobs**, started by the orchestrator. Single-application mode: a script step
`scripts/inventory.py` (size, complexity, per-file hashes and the relative index), three parallel jobs (a
**legacy-analyst** structure job, a **legacy-analyst** debt job, a **security-auditor** scan job), the topology
extraction (a **legacy-analyst** job writes `assessment/$app/tools/extract_topology.py`, a script step runs it),
the **item catalog** (`scripts/catalog_from_topology.py`, a **legacy-analyst** curation job,
`scripts/apply_catalog_edits.py`, `scripts/reconcile_catalog.py`), then a **legacy-analyst** synthesis job that
writes `assessment/$app/ASSESSMENT.md` and `assessment/$app/ARCHITECTURE.mmd`. Portfolio
mode: per application, the `scripts/inventory.py` script step and one **legacy-analyst** survey job (workflow
`workflows/portfolio-assess.js`), then a synthesis job that writes `assessment/portfolio.md` and
`assessment/portfolio.json`. Every job reads the application's legacy repository read-only at a fixed commit
and writes only through `outputs_write`; the worker commits the outputs to the document repository as
`kintsugi-bot`, and the portal shows them.

**Mode.** If `$ARGUMENTS` starts with `--portfolio`, run **Portfolio mode** over every application of the
project. Otherwise run **Single-application mode** on `$app`, the first token: the application id from
`kintsugi.yaml`.

The code is the **legacy repository** of `$app`, registered on the application in `kintsugi.yaml`
(`role: legacy`); each job reads it at the commit the orchestrator pinned for this run. Say which repository and
commit were read in one line at the top of every artifact. If the application has no legacy repository, the
stage cannot start: the orchestrator says so, and the fix is registering one on the application in the portal.

---

# Portfolio mode (`--portfolio`)

Sweep every application of the project and produce a heat-map a steering committee
can use to sequence a multi-year program.

The orchestrator lists the applications from `kintsugi.yaml` (the workflow has no filesystem access) and the
portal shows the count before the stage starts (30 applications means 30 survey jobs). Per application it runs
the `scripts/inventory.py` script step on that application's legacy repository, then the orchestrator runs
workflow `workflows/portfolio-assess.js`, one **legacy-analyst** survey job per application, all independent,
with `args: { apps: ["<app1>", "<app2>", ...], inventories: ["<path of each application's inventory.json>", ...] }` and each job reading its own
application's legacy repository. Each job is given its application's `inventory.json` and fills in the parts
that need reading the code (dependency freshness, documentation coverage, risk notes); runtime jobs have no
shell, so the measured figures (lines, file count, complexity, the tool that produced them) come from the
script step, never from the job. Each job returns a metrics row and the workflow computes the COCOMO index in
code, so every row uses the same formula. If the run stops mid-sweep, the orchestrator resumes it and finished
applications return from cache.

Per application: SLOC and dominant language, file count, complexity measured one way for every application
(the script step's per-file decision-point count summed, divided by KSLOC, and the most complex single file),
dependency freshness (age or pinned-version count of the
manifest), documentation coverage (source files whose opening comment
describes the file, not just a license, and architecture docs present), and the COCOMO index `2.94 × KSLOC^1.10`. **The
index is a relative size measure for ranking applications, never a timeline or a cost**
(it assumes human-team productivity): label the column "index", never print
person-months, a date or a duration.

A **legacy-analyst** synthesis job writes, from the workflow's returned rows:

- `assessment/portfolio.json`: the rows as returned (one object per application, plus `unmeasured` and
  `complexityIndexFormula`), the legacy repository and commit each row was measured at, and the date. The
  portal's portfolio view reads this file.
- `assessment/portfolio.md`: one row per application, columns **Application · Lang · KSLOC · Files ·
  Complexity per KSLOC · Most complex file · Dep Freshness · Doc Coverage % · Complexity index · Risk**, the
  unmeasured applications marked as such, and a 2–3 sentence recommendation of which application goes first and
  why.

The portal renders the heat-map from `portfolio.json` (index and Risk cells graded green to red). Then stop.

---

# Single-application mode

Assess the legacy repository of `$app` so a VP of Engineering could take a fact-grounded brief into a
budget meeting.

## Step 1 — Inventory

Script step `scripts/inventory.py $app --source <source checkout> --source-repo <the application's repository> --source-commit <the commit the job read> --out assessment/$app` writes `assessment/$app/inventory.json`: SLOC and
file count per language, the per-file complexity (decision keywords counted the same way for every
application: `IF`/`EVALUATE`/`PERFORM` for COBOL, `if`/`for`/`while`/`case`/`catch` for C-family, and the
language's equivalents elsewhere), the 25 most complex files, and the index `2.94 × KSLOC^1.10`. Use the index
**only as a relative scale index**: the script prints no schedule, effort or dollar figure, and nothing
downstream may derive one, because a human-team timeline and budget are invalid for agentic modernization.
The script records which method produced the numbers; the synthesis job says it.

## Step 2 — Technology fingerprint

With file evidence: languages, frameworks and runtime versions; build system and
manifest locations; data stores (schemas, copybooks, DDL, ORM configs);
integration points (queues, APIs, batch interfaces, screen maps); test presence
and rough coverage signal. This is part of the structure job's task (Step 3, job 1), given
`inventory.json`.

## Step 3 — Deep analysis (three jobs, in parallel)

1. **legacy-analyst** — "Build a structural map of the legacy repository of $app: the 5–12 major
   functional domains (group optional subsystems under one umbrella), which
   files belong to each, and how they depend on each other (control flow and
   shared data). Return a markdown table and a Mermaid `flowchart TB` of the
   domains drawn by the `mermaid-diagrams` skill: one `subgraph` per domain,
   nodes classed by kind (ui, service, batch, store, external), at most 40
   edges. Cite repo-relative
   paths. Flag dangling references." Also: the technology fingerprint of Step 2.
2. **legacy-analyst** — "Identify technical debt in the legacy repository of $app: dead code,
   deprecated APIs, duplication, god objects, missing error handling, hardcoded
   config. Return the top 10 by remediation value, each with file:line. Mask any
   credential value per your secret-handling rules."
3. **security-auditor** — "Scan the legacy repository of $app for vulnerabilities: injection, auth
   weaknesses, hardcoded secrets, vulnerable dependencies, missing input
   validation. Return a CWE-tagged table with file:line and severity. Mask every
   credential (file:line plus a 2–4 character preview, never the value)."

The orchestrator waits for all three and hands their outputs to the next steps.

## Step 3a — Topology and item catalog

The catalog (ADR-0033) is the menu a person later picks from: the `understand` stage runs on a selection of its
items. It is built without parsers, from a topology the model-written extraction script produces:

1. **legacy-analyst** writes `assessment/$app/tools/extract_topology.py`, a standard-library script that reads only
   the source checkout and writes `topology.json` (modules, data stores, edges, entry points; the schema of the
   `understand` stage), starting from the structure job's domains and any dependency export under
   `assessment/$app/graph/`. A script step runs it in the standard script environment; when it fails, the job
   gets the error once to fix it. The skeleton `assessment/$app/topology.json` (no descriptions) is committed
   with the script.
2. Script step `scripts/catalog_from_topology.py` proposes the catalog: a module per domain, an item per topology
   leaf (data stores never are; small leaves of one directory grouped), every file of `inventory.json` in exactly
   one item or `unassigned`, and per item its code lines, a complexity band and a digest of its files' hashes.
3. A **legacy-analyst** curation job returns structured edits (rename, kind, summaries, merge, split, move files
   or items, parts). Script step `scripts/apply_catalog_edits.py` applies each edit that keeps every file in
   exactly one item and rejects the others with a reason.
4. Script step `scripts/reconcile_catalog.py` keeps the ids of the catalog on the default branch: an item that
   overlaps an old one by half of their files (Jaccard) keeps its id, a renamed item keeps its old names as
   aliases, a split keeps the id on its largest piece, and an old item that matches nothing stays as `retired`.
   Without a previous catalog it keeps the ids of the units the `understand` stage proposed earlier
   (`knowledge/as-is/$app/units.json`, `units/$app/`). It writes `assessment/$app/catalog.json`.

## Step 4 — Production runtime overlay (optional)

Runtime jobs have no network and no MCP servers, so telemetry reaches this stage only as exports a person
supplied (APM exports, batch logs) in the document repository under `assessment/$app/telemetry/`, attached
through the portal. If they exist, the synthesis job gathers p50/p95/p99 for the key jobs or routes, tags each
domain with its wall-clock cost and p99/p50 variance, and calls out the highest-variance domain as
the operational risk. Include a small Runtime Profile table. If none exists, say
so in the assessment and move on.

## Step 5 — Documentation gaps

Compare what the code *does* with what README, docs and comments *say*: list the
top 5 behaviors or subsystems a new engineer would need explained. This is part of the synthesis job's task.

## Step 6 — Write the assessment

A **legacy-analyst** synthesis job, given `inventory.json`, the three Step 3 outputs and any telemetry, writes
the files below via `outputs_write`.

**Secrets first.** The assessment gets shared and committed, so discovered
credential values never appear in it. If credentials were found:

1. Kintsugi never commits raw credentials. The credential inventory is a **restricted portal record**: the job
   writes it to `restricted/SECRETS.local.md` in its output directory, and the worker stores everything under
   `restricted/` as the restricted record (visible only to people with the permission for it) and never commits
   it to the document repository.
2. The record holds, per credential, a masked preview, `file:line`, type,
   what it grants, production or test guess, rotation advice. It never holds a raw value: the source file at
   the cited line is the canonical location for anyone who legitimately needs it.
3. Masking applies to every section of `ASSESSMENT.md`, whichever job produced the
   finding (Technical Debt quotes hardcoded config too). Security Findings
   points to "Credential inventory in the restricted portal record (not committed; not for sharing)".

Write `assessment/$app/ASSESSMENT.md` with: **Executive Summary** (3–4 sentences:
what it is, how big, how risky, the headline recommendation) · **System
Inventory** (from `inventory.json`, saying which method measured it, and the legacy repository and commit
read) · **Architecture at a Glance** (domain table, refer to the diagram) ·
**Production Runtime Profile** (or "no telemetry available") · **Technical Debt**
(top 10) · **Security Findings** (CWE table) · **Documentation Gaps** (top 5) ·
**Relative Scale** (the index and KSLOC for ranking against other applications; state
plainly that it is not a timeline or a cost, and print no person-months, schedule,
cost or date) · **Recommended Modernization Pattern**: one of Rehost, Replatform,
Refactor, Rearchitect, Rebuild, Replace, with a one-paragraph rationale and the
stage it routes to: a move to a newer version of the same technology (or its
supporting platform) → `uplift`; a rewrite in another technology, piece by piece →
`transform`; a rebuild on a new architecture → `reimagine`. Rehost (move as is) and
Replace (buy or adopt a product) change no code, so no build stage applies: say so,
and say what the analysis is still good for. For Rehost, `map`, `harden` and the `preflight`
build check show what the move must carry along; for Replace, `extract-rules` turns
what the application does into the acceptance criteria a replacement is judged against.

Also write `assessment/$app/ARCHITECTURE.mmd`, the domain diagram from the
structure job: one `flowchart TB` per the `mermaid-diagrams` skill, without a
Markdown fence, within its size limits (collapse or split with an index diagram
when the estate is bigger).

## Step 7 — Finish

The worker commits the outputs; the portal shows the assessment (`assessment/$app/ASSESSMENT.md`) and the item
catalog on the application's page. The next step is understanding: a person selects items or modules of the
catalog and runs `understand` on them.
