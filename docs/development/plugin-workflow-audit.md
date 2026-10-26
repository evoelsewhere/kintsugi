# Plugin workflow audit and verification

Date: 2026-10-26. Scope: the built-in `reverse_engineering` and `modernize` plugins, their delivery API, orchestrator
plans/scripts, artifact readers, member build contract and portal. Baseline: `cacb519` from the latest remote master;
work continues on the main checkout. The findings led to [ADR-0082](../decisions/0082-design-readiness-drafts-and-in-place-gap-answers.md).

## Execution paths inspected

| Path | Evidence and ownership |
| --- | --- |
| Assess → plan-understand → understand | The merged catalog scopes selected items; understand fans out rules, security and specification jobs; deterministic finish normalizes references and publishes specifications/traces/records through the writer. Rebuilds derive application views after the default branch moves. |
| Design / regenerate | The API resolves a set and selected units, checks ownership and evidence, pins documents; scaffold prepares templates, designers write, checks and independent reviewers report, one fix round runs, and a reviewed document PR carries results. |
| Member build → runtime review | The member implements/tests in a target checkout and records application, unit and MR/commit. The API checks the selection; the worker reads the target commit without executing it, and publishes review documents. |
| Human corrections | Answers edit their original specification rows; rule decisions use the original rule/card and existing ledger; design-origin questions are corrected in the affected design section. Portal corrections are bounded, permission-gated PR proposals. |

## Findings addressed

| Finding | Change / regression coverage |
| --- | --- |
| A unit card or successful previous stage was treated as enough evidence for a final design | Evidence checks read the actual specification, rules and current understanding/catalog digest. Missing/invalid inputs produce actionable conflicts; worker repeats the check before LLM jobs. |
| Regeneration bypassed dependency checks | Final regeneration uses the same blockers as first generation. Draft is an explicit exception for incomplete evidence, never for invalid templates, unknown scope or busy selections. |
| Definitions and overview could come from different default-branch tips | Definitions are loaded at the overview's commit, which is also pinned into the run. |
| Catalog units without a card could not be explored | Active catalog units appear in the design view; they can explicitly generate a draft, without fabricating an understanding record or unit card. |
| A designer could write unrelated documents into its job output | The stage validates final outputs against the selected unit/application design-set folders before indexing/publication; a real-job regression refuses unrelated standards changes. |
| A draft could look like an acceptable prerequisite/build input | The worker reapplies the marker after agent output/fixes; both checkers reject it as conformance, the Build view excludes it and review preparation/member instructions stop. Real-job tests verify that the PR stays draft. |
| Gaps had no validated resolution state | Backwards-compatible optional columns on the original row; status alone/placeholder evidence does not resolve it. Strict preflight checks malformed/duplicate rows, columns and orphan IDs. Tolerant display parsers do not replace validation. |
| Answers could overwrite newer content or disappear during regeneration | Compare-and-set in the common writer, API stale-document check, reviewed writes only; re-understanding carries merged answers and reopens changed evidence. Malformed previous answered registers fail instead of being discarded. Design regeneration retains the previous documents in private job scratch before skeletons overlay the inputs; the manifest names those snapshots so the designer can read supported reviewed decisions for semantic preservation in the PR. |
| Counts could remain stale after an answer was merged | Understand results and aggregate rebuilds derive open counts from the specification instead of trusting the previous trace snapshot. Resolved history remains visible. |
| An in-place edit could select a pipe-prefixed example instead of the actual table | The shared Markdown reader supplies real, unfenced table source ranges; answer editing changes the named row and preserves surrounding sections. |
| Same unit key in several applications could pick the wrong member MR | Build activity now includes its application; joins filter on it. Unscoped legacy records are used only in a single-application project. |
| Queued workflow calls could start after earlier calls exhausted tokens | The workflow executor checks its token budget after acquiring a concurrency slot; a regression test queues three calls with capacity for one. |

The database's existing transactional scope claims remain the final concurrency check. The new draft flag is carried
in the existing run JSON, so it cannot evade those claims. Runtime jobs still write only job output/scratch; the writer
alone proposes document changes. There is no target-code writer, external answer store, new runtime tool or infrastructure.

## Verification

The tests use representative catalogs, specifications, design sets/profiles, rules, target changes and real Git
repositories. Designer/reviewer agents are scripted; no live model run or production project mutation is part of this
audit. The scripted end-to-end cases exercise the actual plugin scripts and worker workspace/output path, not a
reimplementation of those scripts.

- TypeScript builds, type checks and lint cover domain, agents/readers, Git, API, portal and orchestrator.
- Plugin readers test evidence readiness, gap resolution, malformed input, orphan references and bounded in-place edits.
- Python suites test strict/draft scaffold behavior, dependency checks, persistent draft markers, answer carry/reopen,
  preserved history and derived open counts. Shared resolution helpers in both plugins are checked for equality.
- API use-case tests cover final rejection, explicit draft, regeneration, busy/template boundaries, commit pinning,
  one-file hash-guarded corrections, stale content and application-scoped build records.
- Worker tests cover generation/review/fix/publication, refusal before agents, draft persistence and workflow budgets.
- Git tests use real commits, test all-file preconditions before mutation, idempotent retries and concurrent writes.
- Both plugins are checked with `claude plugin validate --strict`.

Recorded results:

| Suite | Result |
| --- | --- |
| Domain | 64 passed |
| Agents and readers | 94 passed |
| API unit/use cases | 98 passed, 1 existing skip |
| Portal | 134 passed |
| Git | 45 passed |
| Worker full suite | 130 passed, 41 database-dependent skips |
| Final regeneration-context and flow checks | 17 passed; the agent's actual read-only inputs contain the previous design snapshot |
| Modernize Python | 97 passed, 15 subtests |
| Reverse engineering Python | 152 passed, 15 subtests |
| Build, typecheck, lint | 23 tasks passed |
| Plugin validation | Both pass strict validation |

On this macOS host the system Git is below the project's minimum version. Git/process suites are run with the bundled
Git 2.53.0 through a temporary task-local wrapper. `TMPDIR=/private/tmp` avoids the `/var` symlink ambiguity in Node's
child-process permission tests; no runtime permission was widened. Postgres integration suites require `DATABASE_URL`;
it is not configured in this environment, so those database-backed tests are skipped. Database migration/HTTP/queue
integration should also run in the release environment before deployment.

## Limits to retain in review

- Shape checks do not prove semantic completeness or that an expert statement is true. Git reviewers own acceptance;
  a successful generation/run is not a gate approval. Free-form design decisions still require a semantic PR diff review.
- Gap evidence must be corrected at its source. A chat reply or merged draft does not settle a blocking question.
- A merged answer can take one mirror-sync/rebuild cycle to appear in an application aggregate; final readiness reads
  the canonical specification at the pinned commit directly.
- Legacy member records without an application need to be recorded again in multi-application projects; install the
  updated member plugin for that project before re-recording them.
- Runtime review reads code/tests but does not execute them. The later `verify` proof remains outside these changes.
