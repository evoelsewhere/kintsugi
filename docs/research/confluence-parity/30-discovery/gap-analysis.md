# Finding and lifecycle: gap analysis

> Status: research, proposed. For each group of the [feature matrix](feature-matrix.md): what Kintsugi has today (code or documentation), what is missing, the smallest way to close it and the constraint it touches. Constraints are abbreviated **MD** (the document repo is Markdown only, [ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)), **Git** (Git is the source of truth, [ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)) and **PG** (Postgres is the only datastore, [ADR-0010](../../../decisions/0010-postgres-only.md)). The architects' decisions on the open questions are in [open questions](open-questions.md); the design they feed is in target architecture (`../40-architecture/target-architecture.md`) and Brain integration (`../40-architecture/brain-integration.md`).

## What exists today

| Part | What it does | Where |
|---|---|---|
| Document read path | Lists a directory and reads a Markdown file of the project's document repo mirror at a branch or commit; refuses `restricted/`, `.git` and files over 2 MiB | `apps/api/src/modules/delivery/documents/interface/documents.controller.ts` (`documents/refs`, `documents/tree`, `documents/file`); `git-mirror.reader.ts` |
| Brain index | One tree of the default branch (folder, document, section, card) with title, summary, line range, size, ids and links; documents carry their last change (`changed`); rebuilt whole by the worker when the branch moves | `packages/domain/src/brain.ts`; `knowledge.brain_source`, `brain_node`, `brain_link` (`apps/api/migrations/043_brain.sql`); [Brain](../../../reference/brain.md) |
| Brain reads | `brain_tree`, `brain_read`, `brain_lookup`, `brain_grep` (`git grep` over the mirror: fixed strings, all words on a line, at most 50 lines, `under` scope), `brain_changes` (a `git diff --name-status` and `--unified=0` between two commits, per document and section) | `apps/api/src/modules/delivery/brain/interface/brain.controller.ts`; `git-mirror.reader.ts:95` and `:120` |
| Portal Brain page | Tree, node text with citation and links, a search box (lookup or grep), state and build | `apps/portal/src/pages/brain/` |
| Write path | A write is a request to the worker's writer, which commits to the default branch for auto-commit paths and otherwise opens a pull request from `kintsugi/<actor>/<write-id>`, records the outcome and watches the review; the person is recorded in `workflow.document_write.actor` | `apps/api/src/modules/admin/document-writes/`; `services/orchestrator/src/document-write/`; [write path](../../../reference/document-repo-write-path.md) |
| Templates as project data | Design sets under `01-standards/templates/` scaffold design documents and keep `template: "<set>@<version>"` in front matter | [design templates](../../../reference/design-templates.md) |
| Statuses in front matter | A document whose `status` is `superseded`, `deprecated`, `rejected`, `retired`, `withdrawn`, `obsolete` or `replaced` starts its Brain summary with it | [Brain, summaries](../../../reference/brain.md#where-summaries-come-from) |
| Activity records | A member's document and Brain reads are recorded (`document.read`, `brain.read`), without text, and pruned after the telemetry retention | [member CLI](../../../reference/member-cli.md) |
| Full-text index precedent | `knowledge.project_memory_entry` has a GIN index on `to_tsvector('simple', …)` | `apps/api/migrations/038_agent_memory_lifecycle.sql` |

## Search

| Rows | Exists | Missing | Smallest closure | Constraint |
|---|---|---|---|---|
| DIS-01, 17 | Brain page search (lookup of an id, node id or path; otherwise grep) in one project | A search box in the portal shell; a title search; a search across the projects a person may read | Put the existing Brain search into the shell for the current project; add a title filter to the node query (`knowledge.brain_node.title`); cross-project search only after one project works | PG: reads of several projects must check Project Access per project |
| DIS-02, 03 | `brain_grep`: all words on one line, phrase in quotes, case-insensitive; each line in its deepest node, with a citation | Words on different lines; highlighting of the match; more than 50 lines | Keep as is; highlight in the portal from the returned line; paginate | none |
| DIS-04 | Nothing ranks; ADR-0091 chose tree navigation and exact search | A ranked list | A derived Postgres full-text index: `tsvector` per section node, weights title > headings > body, `websearch_to_tsquery`, GIN, built in the Brain build transaction from the same commit. See [ranked search](#ranked-full-text-search-and-adr-0091) below | PG, Git: derived, rebuildable, never the source |
| DIS-05 to 09 | `under` (a folder scope); `changed` per document (date and subject) | Filters by label, contributor, kind and date as parameters of one search | Add `labels`, `status`, `updated` columns to the document node (read from front matter at build time, [labels](#labels)); filter in SQL; the contributor comes from the write record ([history](#version-history)) | MD (the data is front matter), PG |
| DIS-10, 16 | Nothing | A query language, `OR`, wildcards | Structured parameters instead of a language; `websearch_to_tsquery` already accepts `or`, quotes and `-` | none |
| DIS-12 | Nothing (no comments) | Comments in the index | The comment store of the collaboration track feeds the same index with a kind `comment`; no work here before it exists | PG: comments are working state in Postgres (collaboration (`../20-collaboration/feature-matrix.md`)) |
| DIS-14 | Member reads: Project Access and `member.read` per request; `restricted/`, `plugins/`, `scratch/`, hidden folders, identifier ledgers never indexed. Portal reads: a session only (`documents.controller.ts:2-4`, `brain.controller.ts:1`) | Project Access on portal wiki reads; page-level view restrictions (decided against by the collaboration track: Project Access is the view boundary) | New wiki routes check Project Access per request; no access list on index rows ([Q7](open-questions.md#q7-access-in-search)); whether the existing portal routes follow is [Q8](open-questions.md#q8-portal-reads-and-project-access) | PG |
| DIS-11, 13, 15 | Nothing | Attachment text, typo tolerance, saved searches | Out of the first phases; `pg_trgm` for typo tolerance is a contrib extension of the Postgres image and needs a decision | PG |

### Ranked full-text search and ADR-0091

Recommendation: **add a ranked path beside `brain_grep`, as a derived index, and keep tree navigation as the way an agent reasons.**

Why the choice of ADR-0091 stands for agents: a ranked list "hides why a passage was chosen" and similarity ranking is not what agents need to cite. A Brain read is traceable to lines at a commit; a wiki's readers, who are mostly people, ask for something different: type two words, get the best page first.

Trade-off:

| | Tree and exact search (today) | Ranked full-text index (proposed second path) |
|---|---|---|
| Explainable | Every step is a summary the reader can see | The score is not shown; mitigated by always showing the matching line and its citation `path:lines@commit` |
| Finds words not in a summary | Yes, by grep | Yes |
| Order of results | Node order | By weight, then recency |
| Cost | None to store; grep runs per call over the mirror (`git grep`) | One `tsvector` per node, built in the Brain build; storage and build time grow with the text |
| Failure | None beyond the mirror | A stale index when a build fails; the Brain already keeps the last good tree readable and says which commit it holds |
| Constraints | Git and PG untouched | PG only; derived and rebuildable from Git, so not a second source of truth |
| Needs an ADR | No | Yes: amends "not adopted as the primary path" of ADR-0091; assigned to the architects' proposal 0097 |

The index must never replace `brain_tree`, and an agent's instructions keep saying: descend by summaries first, use exact search for words no summary shows, use the ranked search to get a first guess; cite lines in every case. ADR-0091's evaluation duty ([Brain eval](../../../development/brain-eval.md)) extends to it: judge answers and citations on known questions before the ranked path is called better.

## Labels

| Rows | Exists | Missing | Smallest closure | Constraint |
|---|---|---|---|---|
| DIS-20, 22 | Front matter can hold a short list ([document formats](../../../reference/document-formats.md#building-blocks)); `tags` only in agent memory | A `labels` key convention, normalisation and limits; the Brain does not keep front matter fields except title, summary and ids | Define `labels:` as a front matter list, normalised to lower case with hyphens, bounded in length and count; the Brain build reads it into a `labels text[]` on the document node with a GIN index | MD, Git: the label is in the page; PG holds the derived index (decided, [Q2](open-questions.md#q2-labels-and-page-metadata)) |
| DIS-21 | Nothing | A label page | A portal route that lists document nodes with a label; the same query backs the filter | PG |
| DIS-23 | Nothing | An embedded list | A page directive of the macro system (authoring (`../10-authoring/feature-matrix.md`)) rendered by the portal from the node query; in an agent's text it stays a plain line naming the label | MD: the directive is plain Markdown |
| DIS-24 | Nothing | Counts per label | `select label, count(*)` over the node query | PG |

What the Brain answers already: a node's title, summary, ids and links. What it must not do: store a second, editable copy of labels. A change to a label is a change to the page, published through the write path and visible after the next build.

## Templates

| Rows | Exists | Missing | Smallest closure | Constraint |
|---|---|---|---|---|
| DIS-30 to 32 | Design sets: Markdown templates with directive comments, scaffolded by `scaffold_design.py`, checked by `check_design.py`, linked through `template:` in front matter | A free-page template picked by a person; placeholders; the Create dialog | Templates under `01-standards/page-templates/` and `<space>/_templates/` with front matter `type: template`; the portal reads them from the mirror, asks for the `{{placeholders}}`, publishes a `createOnly` write (decided, [Q6](open-questions.md#q6-templates-and-blueprints)) | MD, Git |
| DIS-33 | The ADR template, `templates/document-repo/` (starter) and `templates/document-repo-application/` (skeleton) | A blueprint with an index page | An index page whose body is a directive listing pages by a template id or label, generated from the node query, with no separate store | MD, PG |
| DIS-34, 35 | The application skeleton creates a tree for an application | Promotion, hiding, page-tree templates | Later; a `_templates/` folder per space is the unit of promotion | none |

Search must leave templates out of results by default, so that `type: template` is a filter, not a path rule.

## Version history

How each lifecycle action maps onto Git:

| Action | Git operation | Enough? |
|---|---|---|
| History list (DIS-40) | `git log --follow` of the path on the default branch, bounded and paged | Yes for dates, subjects and commits. The author is not enough: the commit author of a portal write is `kintsugi-bot`, the person is in `Kintsugi-Actor` or `workflow.document_write.actor`, and a squash merge drops the review branch. The review watch must record the merge commit it saw ([Q3](open-questions.md#q3-page-history-diff-restore-and-authorship)) |
| View an old version (DIS-41) | Read the path at a commit; the file read already takes a `ref` | Yes |
| Compare (DIS-42) | `git diff` between two commits for one path; `brain_changes` already runs it per document with `--unified=0` and `-M` | Partly: `brain_changes` keeps only line counts and changed sections; a person needs the text of the change, so the documents read path needs a diff of one file with context, bounded in size |
| Restore (DIS-43) | `git show <commit>:<path>` and a new commit with that text (never a revert of history) | Yes, as a new write through the write path (a pull request, or a direct commit for configured paths) |
| Restore after delete (DIS-46) | `git log --diff-filter=D` finds the deleting commit, `git show <commit>^:<path>` the text | Yes; there is no purge in Git, so there is no trash to empty |
| Keep history on move (DIS-45) | `--follow` and `-M` detect renames heuristically; a stable page id in front matter makes it exact | Partly: a heavily edited and moved file may lose the link; the stable id decided by the authoring track repairs it (authoring question 5 (`../10-authoring/feature-matrix.md`)) |
| Recent changes (DIS-47) | `git log` of the space's folder since a commit; `brain_changes` for sections | Yes |
| Delete one version, retention (DIS-48) | A history rewrite | No, and not wanted: [ADR-0007](../../../decisions/0007-git-as-source-of-truth.md); marked Won't |

Constraints: **Git**, history is read on request from the mirror, never stored in Postgres or the Brain (ADR-0091 item 6 stays). The only addition in Postgres is a join of commit to actor, which `workflow.document_write` already has. Bounds to state in the contract: the number of commits per list, the size of a diff, and the answer when the mirror lacks a commit (the Brain's `linesKnown: false` is the model).

## Archive

| Rows | Exists | Missing | Smallest closure | Constraint |
|---|---|---|---|---|
| DIS-50, 51 | `status` values in front matter change a node's summary; no hiding | A state `archived` honoured by tree, search and grep; a list; restore | `status: archived` in front matter (decided, [Q5](open-questions.md#q5-archive)); the build records it on the node; default `brain_tree`, ranked search and `brain_grep` leave archived pages out and a flag brings them back; archiving and restoring are page writes; the portal counts pages that link to a page before it is archived (the Brain keeps links) | MD, Git |
| DIS-52 | Nothing | Bulk archive | A write of several files at once; the write path allows 500 files per write | none |

The Brain keeps archived pages in the tree (the tree mirrors the repository) and marks them; the filter belongs to the read, not to the build, so an auditor can still find them.

## Analytics and personal lists

| Rows | Exists | Missing | Smallest closure | Constraint |
|---|---|---|---|---|
| DIS-60 to 62 | Members' `document.read` and `brain.read` activity records, no text, pruned after the retention; portal reads are not recorded | A view count per page and day, unique viewers, a report | Count portal page views and agent reads into a per-page, per-day aggregate in `monitoring` with the same retention; no user id by default (decided, [Q4](open-questions.md#q4-per-user-state)) | PG |
| DIS-63 | `brain.read` records the node, commit and lines | A report of what agents read and never read | Join the aggregate to the node list; the pages with no reads in a period are the archive candidates | PG |
| DIS-70 to 72 | Nothing for documents; the portal has overview pages | Starred and recent lists, a home | `knowledge.wiki_favourite` and `knowledge.wiki_recent` per user and project; removed when access ends | PG: personal state never in Git |

## Constraints met

| Constraint | Where this area meets it | Resolution |
|---|---|---|
| MD | Labels, templates and status need structure | Front matter keys and Markdown directives only; no JSON in the repo |
| Git | History, diff, restore, delete | Read from the mirror; no history in Postgres; restore is a new commit |
| PG | A ranked index, personal lists and view counts | Derived, rebuildable index in `knowledge`; personal and telemetric state in Postgres; nothing new outside Postgres |
| ADR-0091 | Search and history meet the Brain | Tree navigation stays primary; ranked search is a second path with citations; history is not indexed |

## Risks

- A Brain build that fails leaves the ranked index and the labels at an older commit; every answer must name the commit it comes from, as Brain reads do.
- `--follow` can lose a renamed file's history; without a stable page id the history list may be shorter than the truth.
- The index grows with the text; the bounds of the Brain (20,000 documents, 2 MiB per file) apply to it too.
- View counts are personal data when they carry user ids; the default stores none.
