# Finding and lifecycle: feature matrix

> Status: research, proposed. What a Confluence-like wiki offers to find content and to manage its life (search, labels, templates, history, archive, analytics, personal lists), what Kintsugi has today, and a MoSCoW proposal for each. The product owner decides the final priority in scope and priorities (`../00-scope-and-priorities.md`).

Part of the Confluence parity research (`../README.md`). Companion pages: [user stories](user-stories.md), [gap analysis](gap-analysis.md), [open questions](open-questions.md).

## How to read it

- **Behaviour** is what the public documentation of Confluence (Cloud unless a row says Data Center) describes, in one sentence. A row's **Source** is a public page that needs no sign-in. Third-party pages are marked *secondary*.
- **Kintsugi today**: `have` (the behaviour exists), `partial` (a part exists) or `gap`. Every status points to code or to a page of the documentation; the reasoning is in the [gap analysis](gap-analysis.md).
- **MoSCoW** is a proposal: **M**ust, **S**hould, **C**ould, **W**on't (in this scope). It assumes the constraints stay as they are: the document repo is Markdown only ([ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)), Git is the source of truth ([ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)) and Postgres is the only datastore ([ADR-0010](../../../decisions/0010-postgres-only.md)). Where a row hinges on a constraint the architects still decide, it says so and points to the [open question](open-questions.md).
- A *space* is read as a folder of the project's document repo and a *page* as a Markdown document; the authoring track owns that decision (authoring (`../10-authoring/feature-matrix.md`)).

## Search

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-01 | A search box on every screen finds pages across all spaces the person can see | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | partial: the Brain page searches one project's indexed branch (`apps/portal/src/pages/brain/brain-search.tsx`); no global box, no cross-project search | M |
| DIS-02 | Matches the words in the title and in the body, in any order, with quoted phrases | [Confluence search syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/) | have: `brain_grep` holds every word of the text on one line in any order, a quoted text is one exact phrase, case-insensitive (`apps/api/src/modules/delivery/documents/infrastructure/git-mirror.reader.ts:95`, [Brain reads](../../../reference/brain.md#reads)); words on different lines are not found | M |
| DIS-03 | Each hit shows an excerpt with the matching words highlighted and where the page lives | [Ranking of search results](https://support.atlassian.com/confluence/kb/how-to-understand-the-ranking-of-confluences-search-results/) | partial: each grep line is shown in the deepest node that holds it, with a breadcrumb and a citation `path:lines@commit` (Brain page); no highlighting, 50 lines at most | M |
| DIS-04 | Results are ranked: a title match counts more than a body match and newer content is slightly more relevant | [Ranking of search results (Data Center)](https://confluence.atlassian.com/display/DOC/Ranking+of+Search+Results) | gap: grep results come in node order, never ranked; [ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md) did not adopt ranking as the primary path because a ranked list hides why a passage was chosen | S (a ranked path that always shows the matching line, [question 1](open-questions.md#q1-ranked-search)) |
| DIS-05 | Filter by space | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) | partial: `under` limits a grep to a node's subtree (`brain_grep … under`); a project is one repo, so spaces are folders | M |
| DIS-06 | Filter by label | same | gap: no labels yet (DIS-14) | M |
| DIS-07 | Filter by contributor or creator | same | gap: the Brain stores no author per node, and the commit author of a portal write is the bot ([commit conventions](../../../reference/document-repo-commit-conventions.md)); the person is in the `Kintsugi-Actor` trailer | S ([question 3](open-questions.md#q3-page-history-diff-restore-and-authorship)) |
| DIS-08 | Filter by content type (page, blog post, attachment, comment, space) | same | gap: Brain nodes have kinds (document, section, card), not wiki content types | S |
| DIS-09 | Filter by date last modified or created | same | partial: a document carries `changed` (the last commit that changed it, with date and subject, `docs/reference/brain.md`), not filterable; no created date | S |
| DIS-10 | An advanced query language (CQL) combines fields, operators and ordering | [Advanced searching using CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) | gap | C (structured filter parameters of the API and tools cover the use; a query language adds a parser to maintain) |
| DIS-11 | Search inside attachments (PDF, Word, spreadsheets) | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | gap: the Brain indexes Markdown only; attachments depend on authoring question 3 (`../10-authoring/feature-matrix.md`) | W (text extraction needs a converter; revisit when attachments exist) |
| DIS-12 | Search comments | same | gap: comments do not exist yet (collaboration (`../20-collaboration/feature-matrix.md`)) | S, with the comment feature |
| DIS-13 | Tolerance for word forms and typos | [Ranking of search results](https://support.atlassian.com/confluence/kb/how-to-understand-the-ranking-of-confluences-search-results/) (stemming); no source confirms typo tolerance | gap: grep is exact; Postgres full-text search offers stemming per language, not typo tolerance ([Postgres text search](https://www.postgresql.org/docs/current/textsearch.html)) | C |
| DIS-14 | Results respect who may see what | [Search for content](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | partial: member reads need `member.read` and Project Access, and `restricted/`, `plugins/`, `scratch/` and hidden folders are never indexed (`docs/reference/brain.md#left-out`); the portal's document and Brain reads need a session only (`apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`), which a search over every project would widen ([question 8](open-questions.md#q8-portal-reads-and-project-access)); the collaboration track keeps view restrictions out of Git | M |
| DIS-15 | Recent and saved searches | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | gap | W |
| DIS-16 | Operators `AND` and `OR`, grouping with brackets, wildcards `?` and `*` (not at the start of a word) | [Confluence search syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/) | gap: `brain_grep` is all-words AND and exact phrase only | C |
| DIS-17 | *Search titles only*, and quick search that lists the most recently updated items first | [Search for content](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | partial: `brain_lookup` finds an id, node id or path, not a title (`docs/reference/brain.md#reads`) | S |

## Labels

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-20 | Add and remove labels on a page | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) | gap: front matter holds scalars and short lists ([document formats](../../../reference/document-formats.md#building-blocks)), so a `labels` list fits, but nothing reads or edits one; `tags` exist only in the agent memory (`knowledge.project_memory_entry`) | M |
| DIS-21 | A label page lists every page with that label, across spaces | same | gap | M |
| DIS-22 | Label naming rules (lower case, no spaces, a bound on length and count) | same | gap | M (cheap, avoids a label vocabulary that drifts) |
| DIS-23 | A *Content by label* list embedded in a page: AND/OR of labels, space, sorting | [Display pages with label macros](https://confluence.atlassian.com/spaces/DOC/pages/145102/Display+Pages+with+Label+Macros) | gap; depends on macros (authoring (`../10-authoring/feature-matrix.md`)) | S |
| DIS-24 | *Popular labels*: a label cloud or list of the most used labels of a space or site | [Popular labels macro](https://support.atlassian.com/confluence-cloud/docs/insert-the-popular-labels-macro/) | gap | C |
| DIS-25 | Labels on attachments | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) | gap; with attachments | W |
| DIS-26 | Personal (`my:`) labels | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) | gap | W |

## Templates and blueprints

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-30 | Create a page from a template; the template applies only at creation and the page is not linked to it afterwards | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) | partial: design sets scaffold the unit's design documents from `01-standards/templates/` and keep the link in front matter (`template: "<set>@<version>"`, [design templates](../../../reference/design-templates.md)); a person cannot pick a template for a free page | M |
| DIS-31 | Space and site templates, written by space or site admins | same | partial: templates are project data in the document repo, written by people in pull requests; no portal screen | S |
| DIS-32 | Template variables: fields the author fills in, and instructional text that disappears | same | partial: design templates carry directive comments (`<!-- required … -->`) that guide and validate; no author-facing placeholders | S |
| DIS-33 | Blueprints: ready-made templates with extra behaviour (meeting notes, decision log, how-to, product requirements) and an index page of what was created | [Blueprints](https://support.atlassian.com/confluence-cloud/docs/pre-format-your-content-with-templates/) | partial: the ADR template (`docs/decisions/template.md`) and the starter repo (`templates/document-repo/`) are blueprint-like but not offered in the portal | S |
| DIS-34 | Templates appear in the Create dialog; admins promote or hide them per space | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) | gap | C |
| DIS-35 | Create a whole page tree from one template | [Space tree creator (Marketplace, *secondary*)](https://marketplace.atlassian.com/apps/1214324/space-tree-creator-blueprint-template) | gap: the application skeleton (`templates/document-repo-application/`) does it for a project's application folders | C |

## Version history

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-40 | A page history lists versions with number, author, date and change comment | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) | partial: Git holds all of it, the Brain keeps only the last change of a document (`changed`); no read of a file's history is exposed | M |
| DIS-41 | View an older version as it was | same | partial: `document_get` and the file read take a `ref` (branch or commit, `docs/reference/member-cli.md`), so an old version is readable when its commit is known; no history list leads to it | M |
| DIS-42 | Compare two versions: added content green, removed red, formatting changes blue | same | partial: `brain_changes` computes a diff between two commits per document and section (`git-mirror.reader.ts:120`), line counts and changed sections, never text; no side by side or inline text diff | M |
| DIS-43 | Restore a version: it becomes a new current version and the history is kept | same | gap: a restore is a new write; the write path exists (`workflow.document_write`, PR or direct commit) | M |
| DIS-44 | Restoring warns when an unpublished draft exists and discards it | same | gap; depends on drafts (authoring (`../10-authoring/feature-matrix.md`)) | S |
| DIS-45 | A page keeps its history when it is moved or renamed | [Move and reorder pages](https://support.atlassian.com/confluence-cloud/docs/move-copy-and-hide-pages/) | gap: Git follows renames heuristically (`brain_changes` marks a moved document `renamed`); a stable page id is authoring question 5 (`../10-authoring/feature-matrix.md`) | S |
| DIS-46 | A deleted page goes to the space trash and can be restored, to the root of the space and without its inherited permissions, until it is purged; purging removes all its versions | [Delete, restore, or purge a content item](https://support.atlassian.com/confluence-cloud/docs/delete-restore-or-purge-a-page/) | partial: the file stays in Git history and can be read at an older commit; no restore flow; a purge does not exist in Git ([ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)) | S |
| DIS-47 | A recent-changes feed per space and site ("Recent updates") | [Confluence home page](https://support.atlassian.com/confluence-cloud/docs/experience-the-new-home-page/) | partial: `brain_changes` answers "since this commit" per section; the delivery overview lists document writes (`workflow.document_write`); no wiki feed | S |
| DIS-48 | Delete one version permanently, and retention rules that remove old versions | [Page history](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views); community answers state Cloud has no automatic retention (*secondary*) | not applicable: history in Git is never rewritten ([ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)) | W |

## Archive

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-50 | Archive a page: it leaves the tree and search by default and can be restored; the archive is available on the Standard plan | [Archive content items](https://support.atlassian.com/confluence-cloud/docs/archive-pages/), [introduction](https://www.atlassian.com/blog/confluence/introducing-page-and-bulk-archiving-in-confluence-cloud) | partial: front matter `status` of `superseded`, `deprecated`, `retired`, `obsolete` and others starts a node's summary in the Brain (`docs/reference/brain.md#where-summaries-come-from`); nothing hides such a page | S |
| DIS-51 | A list of archived pages, and restore from it to a parent the person chooses | [Restore archived items](https://support.atlassian.com/confluence-cloud/docs/restore-archived-pages-to-the-page-tree/) | gap | S |
| DIS-52 | Bulk archive and restore, up to 500 pages, a Premium feature | same (Atlassian community reports of a missing bulk restore are *secondary*) | gap | C |

## Analytics

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-60 | A page shows how many people viewed it; details open from the byline | [Content insights and analytics](https://support.atlassian.com/confluence-cloud/docs/view-insights-on-pages/) | partial: a member's reads are recorded as activity (`document.read`, `brain.read`, [member CLI](../../../reference/member-cli.md)) and pruned after `KINTSUGI_TELEMETRY_RETENTION_DAYS`; portal reads are not counted | C |
| DIS-61 | Views and unique viewers over time, a table of viewers with last version viewed, an engagement mark after 20 seconds, and a privacy mode that shows aliases | same | gap | C (privacy mode is a Must if per-person data is kept) |
| DIS-62 | Space and site analytics: most viewed pages, content that nobody reads | same | gap | C |
| DIS-63 | Agent reads count as readers: which pages the members' agents cite | not in Confluence | partial: `brain.read` records node, commit and lines without text (ADR-0091 item 6) | S (Kintsugi's own gain: knowledge that agents never read is a candidate for archive or rewrite) |

## Personal lists

| Id | Behaviour | Source | Kintsugi today | MoSCoW |
|---|---|---|---|---|
| DIS-70 | Star a page; starred pages are listed under Recent | [Star pages](https://support.atlassian.com/confluence-cloud/docs/save-a-page-for-later/) | gap | S |
| DIS-71 | Recently viewed and recently worked on pages | [Confluence home page](https://support.atlassian.com/confluence-cloud/docs/experience-the-new-home-page/) | gap | S |
| DIS-72 | A personal home with recent updates, starred and popular pages | same | partial: the portal has an overview and portfolio pages (`apps/portal/src/pages/overview.tsx`), none of documents | C |

## How search relates to the Brain

The Brain ([ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md)) answers a question by reasoning over a tree: `brain_tree` shows a level with summaries, `brain_read` reads a node with its citation, `brain_lookup` resolves an id or path, `brain_grep` finds exact words and maps each line to its node. It never ranks by similarity and calls no model at query time. A wiki search must not replace this path; it sits beside it:

- **Tree first, search second.** A person browsing the page tree and an agent descending the Brain's summaries use the same nodes. Search is the shortcut for words no summary shows, as `brain_grep` is today.
- **One citation format.** Every search hit, in the portal and in the member tools, names its node and the lines it matched with `path:lines@commit`, so a hit can be checked like a Brain read.
- **Ranked full-text search is a second path, not a rewrite.** sa-platform decided (in the board thread of BD-004, recorded in [open questions](open-questions.md#q1-ranked-search)) that a ranked index in Postgres, built with the same Brain build from the same commit and rebuildable from Git, may serve people and member tools next to `brain_grep`, always showing the matching line. Amending ADR-0091's "not adopted as the primary path" is the job of an ADR proposal of the architects. The [gap analysis](gap-analysis.md#search) gives the trade-off.
- **Labels and status are Brain data.** They live in front matter, the Brain already reads `status` and `summary` from it, and filters of search and tree read the same keys.
- **History is not in the Brain.** ADR-0091 item 6 stays: a document carries only its last change; the page history is read from Git on request by the documents read path.

## Why each Must and Should row matters

One line per row, tied to the persona it serves (`member`, `manager`, `admin`, `viewer` who only reads, `agent` a member's agent reading through the Brain).

| Id | Persona | Reason |
|---|---|---|
| DIS-01 | member | finds a page without knowing which folder holds it |
| DIS-02 | agent | an exact word the summaries do not show is found and cited |
| DIS-03 | agent | the matching line and its citation let the answer be checked |
| DIS-04 | member | the best page comes first and the reason is visible |
| DIS-05 | member | a broad word is narrowed to one part of the project |
| DIS-06 | manager | pages of one topic are found together |
| DIS-07 | viewer | finds what a named colleague wrote |
| DIS-08 | member | leaves comments, templates or generated documents out |
| DIS-09 | member | sees what was touched lately |
| DIS-12 | member | finds a decision that was made in a discussion |
| DIS-14 | Results respect who may see what | [Search for content](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) | partial: member reads need `member.read` and Project Access, and `restricted/`, `plugins/`, `scratch/` and hidden folders are never indexed (`docs/reference/brain.md#left-out`); the portal's document and Brain reads need a session only (`apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`), which a search over every project would widen ([question 8](open-questions.md#q8-portal-reads-and-project-access)); the collaboration track keeps view restrictions out of Git | M |
| DIS-17 | member | jumps to a page whose title is known |
| DIS-20 | manager | labels group pages without moving them |
| DIS-21 | viewer | browses a topic by its label |
| DIS-22 | manager | the label vocabulary does not drift |
| DIS-23 | viewer | a page shows a live list of its topic |
| DIS-30 | member | a new page starts with the structure the project expects |
| DIS-31 | manager | standards for pages are maintained by the project |
| DIS-32 | member | fills in only the fields a template asks for |
| DIS-33 | manager | a decision log lists itself |
| DIS-40 | viewer | knows who changed a page, when and why |
| DIS-41 | viewer | reads a page as it was on a date |
| DIS-42 | member | sees what changed before relying on a page |
| DIS-43 | manager | undoes a wrong change without losing history |
| DIS-44 | member | does not lose an unpublished draft by accident |
| DIS-45 | member | a move does not split the history |
| DIS-46 | manager | brings back a page deleted by mistake |
| DIS-47 | member | sees what the team changed since the last visit |
| DIS-50 | manager | a page that no longer applies leaves search and the tree |
| DIS-51 | manager | finds and restores an archived page |
| DIS-63 | manager | finds knowledge that agents never read, a candidate to rewrite or archive |
| DIS-70 | member | returns to a page in one click |
| DIS-71 | member | picks up where they left off |

## What other wikis show

Wikis that keep pages in a database, and wikis built on a Git repository, make the same features cheap or costly in different places. The lessons for the rows above:

| Wiki | Observation | Source | Lesson for Kintsugi |
|---|---|---|---|
| Azure DevOps code wiki | Publishes the Markdown files of a branch and folder of a Git repository as a wiki; changes to the branch appear automatically; its overview says search relies on searching the code rather than a content-optimised search | [Publish a Git repository to a wiki](https://learn.microsoft.com/en-us/azure/devops/project/wiki/publish-repo-to-wiki) | The same shape as Kintsugi's document repo plus Brain; the search weakness of a code wiki is the reason to add a content index (DIS-04) |
| Wiki.js | Storage modules sync content with a Git repository as backup or source of truth; page history can be compared and restored; the reason for a change can become the commit message; search can be switched to an external engine | [Storage modules](https://docs.requarks.io/dev/storage), [site features (*secondary*)](https://dev.to/selfhostingsh/wikijs-vs-outline-which-to-self-host-lo1) | A change message belongs in the commit message (DIS-40); an external engine is not an option for Kintsugi (ADR-0010) |
| BookStack | Tags with an optional value, searched with `[name=value]` and boosted above normal content; filters such as `{created_by:me}` and `{type:page}`; revisions are cut off after a limit (100 by default) to keep the database small | [Searching content](https://www.bookstackapp.com/docs/user/searching/), [Content tags](https://www.bookstackapp.com/docs/user/tags/), [Other configuration](https://www.bookstackapp.com/docs/admin/other-config/) | Labels with a value (`team: payments`) are a later step; a revision limit is a cost of storing history in a database that Git does not have (DIS-48 stays Won't) |
| Outline | History and restore (a restore creates a new version, revisions can be deleted for good), a trash that keeps deleted documents 30 days, search filters by collection, author and date and an option to include archived documents | [Revision history](https://docs.getoutline.com/s/guide/doc/revision-history-AiL6p22Ssq), [v0.38.0](https://www.getoutline.com/changelog/v0.38.0), [v0.28.0](https://www.getoutline.com/changelog/v0.28.0) | A restore as a new version is common ground (DIS-43); *include archived* is a switch in search (DIS-50, [DIS-US-19](user-stories.md)) |

## Boundaries with the other tracks

Rows that more than one track lists describe one feature; the track named owns the priority, the others point to it.

| Feature | Owner of the row | Other track's row | Split |
|---|---|---|---|
| Archive a page | authoring `AUT-18` owns the action (menu, confirmation, children) | DIS-50, DIS-51 | this track owns the archived state: `status: archived`, hiding it from tree and search, the archived list and the restore into a chosen parent |
| Delete, trash, restore | authoring `AUT-16`, `AUT-17` own the delete and the confirmation | DIS-46 | this track owns finding the deleted page in Git history and restoring it as a new write |
| Version history, who changed what | this track (DIS-40 to DIS-45) | collaboration `COL-36` | `COL-36` points here; authorship in history depends on the write record |
| Page analytics | this track (DIS-60 to DIS-63) | collaboration `COL-39` | `COL-39` points here; one report, one privacy default |
| Content by label, recently updated macros | authoring `AUT-41` owns the macro | DIS-23 | this track owns the label data and the node query the macro reads |
| Templates in the create dialog | authoring `AUT-11` owns the create flow | DIS-30 to DIS-34 | this track owns the template files, placeholders and blueprints |

## What is out of scope here

- Editing, page tree, move and delete flows, drafts, macros and attachments: authoring (`../10-authoring/feature-matrix.md`).
- Comments, mentions, notifications, watching and page restrictions: collaboration (`../20-collaboration/feature-matrix.md`).
- Where the data lives and how the Brain indexes it: data model (`../40-architecture/data-model.md`), Brain integration (`../40-architecture/brain-integration.md`).
