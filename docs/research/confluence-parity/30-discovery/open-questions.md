# Finding and lifecycle: open questions and their decisions

> Status: research, proposed. The constraint questions of the finding and lifecycle area, raised with the solution architects on the fleet's board (thread of ticket BD-004). Each question lists its options, the default the business analyst proposed, the decision and who decided. Seven were decided on the day they were asked; question 8 came from reading the code and is open until its decision is recorded. Each decision is a **proposal** until the ADR proposals 0096 to 0099 are accepted.

Part of the [feature matrix](feature-matrix.md) and the [gap analysis](gap-analysis.md). The constraints behind the questions: the document repo is Markdown only ([ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)), Git is the source of truth ([ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)), Postgres is the only datastore ([ADR-0010](../../../decisions/0010-postgres-only.md)), and the Brain is a vectorless tree whose history is not indexed ([ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md)).

Where the decisions are written as architecture: target architecture (`../40-architecture/target-architecture.md`), constraints and fit (`../40-architecture/constraints-and-fit.md`), data model (`../40-architecture/data-model.md`), Brain integration (`../40-architecture/brain-integration.md`).

## Q1 Ranked search

Confluence ranks a title match above a body match and newer above older, and filters by space, label, contributor, type and date ([DIS-04](feature-matrix.md#search)).

| Option | Meaning |
|---|---|
| a | Keep exact `brain_grep` only and add filters over node metadata |
| b | Add a derived Postgres full-text index (`tsvector` and GIN, weights for title, headings, body), built by the same Brain build, rebuildable from Git, always showing the matching line and citation |
| c | An external search engine (outside ADR-0010) |

**Default:** b. **Decision (sa-platform, 23:38): b.** The index lives in the `knowledge` schema, is built in the same `brain-index` transaction from the same commit, serves people's search and a member-tool shortcut, and never replaces tree navigation. Amending ADR-0091's "not adopted as the primary path" belongs to the ADR proposal 0097 of sa-brain. Precedent in the code base: `knowledge.project_memory_entry` already has a GIN index on `to_tsvector('simple', …)` (`apps/api/migrations/038_agent_memory_lifecycle.sql`).

## Q2 Labels and page metadata

| Option | Meaning |
|---|---|
| a | Front matter keys in the page (Git truth, diffable, read by the Brain) |
| b | A Postgres side table edited in the portal |
| c | Both, front matter winning |

**Default:** a. **Decision (sa-platform): a.** Labels, `status`, owner and template id are front matter; Postgres keeps only the derived index, rebuilt with the Brain.

## Q3 Page history, diff, restore and authorship

Git is the version history. Open: who edited, since the commit author of a portal write is the bot and a squash merge drops the branch.

| Option | Meaning |
|---|---|
| a | Read `Kintsugi-Actor` and `Co-authored-by` trailers and the merge author |
| b | Join each commit with `workflow.document_write.actor`, which already records the person |
| c | Accept the committer only |

**Default:** b and a. **Decision (sa-platform): b and a, with one addition.** History is read from the mirror on request (`git log --follow`, bounded and paged), the diff comes from Git and a restore is a new page write with the old text. The author is `workflow.document_write.actor` joined by commit; for squash merges the review watch must also record the merge commit it saw (a small extension of `services/orchestrator/src/document-write/watch.ts`), else the trailers, else the committer. History is served by the documents read path, not the Brain (ADR-0091 item 6 stays).

## Q4 Per-user state

Favourites, recently viewed and view counts are personal or telemetric, not project knowledge.

| Option | Meaning |
|---|---|
| a | Postgres tables per user and project, never in Git |
| b | Browser storage only |

**Default:** a. **Decision (sa-platform): a.** Favourites and recently viewed per user in `knowledge` (`wiki_` tables); view counts aggregated per page and day in `monitoring` with the telemetry retention; storing counts without user ids is the default.

## Q5 Archive

| Option | Meaning |
|---|---|
| a | Front matter `status: archived`; the page stays in place |
| b | Move to an `_archive/` folder (the path changes, links break) |
| c | Both |

**Default:** a. **Decision (sa-platform): a.** `status: archived` in front matter; the Brain flags it, and default tree, search and grep leave it out.

## Q6 Templates and blueprints

| Option | Meaning |
|---|---|
| a | Markdown templates with front matter and placeholders in the document repo; instantiation is one create-only write; a blueprint is a template plus an index page generated from labels |
| b | Templates in Postgres |

**Default:** a. **Decision (sa-platform): a.** Templates live under `01-standards/page-templates/` and `<space>/_templates/` with front matter `type: template`, so search can leave them out; instantiation fills the placeholders in the editor and publishes through the normal write path (`createOnly`). The Brain does not index `plugins/` and `scratch/`, so templates are kept under `01-standards/`.

## Q7 Access in search

| Option | Meaning |
|---|---|
| a | Project Access is checked per request on the result list |
| b | The restriction is stored on the index rows |

**Default:** a. **Decision (sa-platform): a.** Search and recents check Project Access per request; the collaboration decision keeps view restrictions out of Git, so index rows carry no access list.

## Q8 Portal reads and Project Access

New fact: the portal's document routes and the Brain's portal reads need a session only ("the documents are what the project shares", `apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`, `apps/api/src/modules/delivery/brain/interface/brain.controller.ts:1`); the member API needs `member.read` and Project Access. Search, recents and favourites over every project would show any signed-in user all projects' pages.

| Option | Meaning |
|---|---|
| a | Every wiki read in the portal requires Project Access; the existing document and Brain portal routes follow in the same change |
| b | Only the new wiki routes require it |
| c | Keep session-only: the documents are shared inside an installation |

**Default:** a. **Decision:** pending (sa-platform, asked 23:44, answer by 00:55; the default applies if none comes).

## What this means for the stories

The decisions fix three things the [user stories](user-stories.md) rely on: the history of a page is complete only as far as the mirror holds it and the author comes from the write record; a restore is a new write that follows the project's publication path; an archived page is a front matter state, so archiving and restoring are page writes like any other.
