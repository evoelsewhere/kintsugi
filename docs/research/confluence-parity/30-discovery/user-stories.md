# Finding and lifecycle: user stories

> Status: research, proposed. Stories for the Must and Should rows of the [feature matrix](feature-matrix.md), with Given/When/Then acceptance criteria and the proposed MoSCoW priority. The wording follows the vocabulary of Kintsugi: a *project* has one document repo, a *page* is a Markdown document of it, a *space* is a folder of it (the authoring track decides the exact form, [authoring](../10-authoring/feature-matrix.md)).

Personas: **Member** (a person who works in the portal or through their own agent client), **Manager** (project manager or architect who curates the knowledge of a project), **Admin** (installation administrator), **Viewer** (a reader who only reads; the Auditor of the stories below, who needs to know what a page said and who changed it, and when, is a viewer), **Agent** (a member's own agent reading through the Brain tools of the member API; it cites every answer as `path:lines@commit`).

The criteria describe the behaviour the architects' decisions in [open questions](open-questions.md) allow: labels, status and owner are front matter, history is read from Git, personal state is in Postgres.

## Search

### DIS-US-01: Find a page from anywhere (M; DIS-01, DIS-02, DIS-03, DIS-17)
As a **Member** I want a search box on every portal screen, so that I find the page that holds an answer without knowing its folder.
- Given a project whose Brain is ready, When I type `retry policy` in the search box, Then I see pages whose title or body hold both words, each with its breadcrumb, an excerpt around the match and a citation `path:lines@commit`.
- Given the same project, When I type `"retry policy"` in quotes, Then only pages with that exact phrase are listed.
- Given I turn on *titles only*, When I type `retry`, Then only pages whose title holds the word are listed.
- Given the Brain of the project is not built, When I search, Then I am told so and offered the Brain page (the same state as the Brain's own 409 answer, `docs/reference/brain.md#reads`), and no empty list is shown as if nothing matched.

### DIS-US-02: Narrow a search (M; DIS-05, DIS-06, S: DIS-07, DIS-08, DIS-09)
As a **Member** I want to filter results by space, label, contributor, kind and last-modified date, so that a broad word does not drown the page I need.
- Given results for `interface`, When I choose the space `10-applications/billing/`, Then every result lies under that folder.
- Given pages labelled `adr` and `security`, When I choose both labels, Then only pages that carry both are listed; when I choose *any of*, pages with either label are listed.
- Given pages edited by two people, When I filter by one contributor, Then only pages whose history holds a change by that person are listed ([question 3](open-questions.md#q3-page-history-diff-restore-and-authorship)).
- Given a filter *modified in the last 7 days*, Then a page whose last change is older never appears.
- Given a filter that matches nothing, Then I see an empty state that names the filters and offers to clear them.

### DIS-US-03: Ranked results that show why (S; DIS-04)
As a **Member** I want a page whose title holds my words to come before one that mentions them once in passing, so that the best page is on top and I can see why.
- Given a page titled *Retry policy* and a page that mentions the words once, When I search `retry policy`, Then the titled page comes first.
- Given any ranked result, Then the line that matched and its citation are shown with it, so the ranking never hides the passage.
- Given a ranked search and the Brain's exact search, When I run both on the same words, Then every line the exact search finds is also found by the ranked one, except lines of archived pages when archived pages are hidden (DIS-US-16).

### DIS-US-04: Search shows only what I may read (M; DIS-14)
As an **Admin** I want search, lists and recent pages to follow Project Access, so that a search never leaks a page of a project the person does not belong to.
- Given a person without Project Access to project A, When they search in the portal, Then no page of A is returned, counted or suggested ([question 8](open-questions.md#q8-portal-reads-and-project-access) decides whether the existing portal reads follow the same rule).
- Given a page under `restricted/`, `plugins/`, `scratch/` or a hidden folder, Then it is never listed, in the portal or by a member's agent ([Brain, left out](../../../reference/brain.md#left-out)).
- Given a person who loses Project Access while a search page is open, When they load the next page of results or open a hit, Then the request is refused.
- Given the index rows, Then they carry no access list: the check happens on each request ([question 7](open-questions.md#q7-access-in-search)); a page that must be hidden inside a project is out of scope until restricted pages exist as their own decision.

### DIS-US-05: Search comments with the page (S; DIS-12)
As a **Member** I want a search to find a comment that holds my words, so that a decision made in a discussion is not lost.
- Given a comment that holds `rollback`, When I search `rollback`, Then the page is listed with the comment shown as the excerpt and marked as a comment.
- Given I filter by kind *page*, Then comment hits are left out.

## Labels

### DIS-US-06: Label a page (M; DIS-20, DIS-22)
As a **Manager** I want to add and remove labels on a page, so that pages of one topic can be found together.
- Given a page I may edit, When I add `payments`, Then the label shows on the page and the change reaches the document repo as part of the page's next publication.
- Given I type `Payments Core`, Then it is stored as `payments-core` (lower case, spaces become hyphens), and a label longer than the limit or a page over the label limit is refused with the rule named.
- Given a page already labelled `payments`, When I add `Payments`, Then no second label is created.
- Given I remove a label, Then it no longer appears on the page or in label filters once the change is published.

### DIS-US-07: Browse by label (M; DIS-21, S: DIS-23)
As a **Member** I want a page for each label that lists its pages, so that I can browse a topic.
- Given three pages labelled `payments`, When I open the label page `payments`, Then the three pages are listed with title, space and last change.
- Given a page I may not read carries the label, Then it is absent from my list.
- Given a page that embeds a *content by label* list for `payments` (when macros exist), When I open it, Then it shows the same pages, filtered by the space and sorted as the macro says.

## Templates

### DIS-US-08: Create a page from a template (M; DIS-30)
As a **Member** I want to pick a template when I create a page, so that it starts with the structure my project expects.
- Given templates available in my space, When I create a page, Then the dialog lists them with a description and an empty page.
- Given I choose *Decision record*, Then the new page holds the template's headings and front matter, with the template's id recorded in `template`.
- Given a page created earlier, When the template changes, Then the page is unchanged unless someone applies a new version on purpose.

### DIS-US-09: Maintain templates (S; DIS-31, DIS-32)
As a **Manager** I want to write and version templates for my project, so that standards are followed without a review of every page.
- Given I have the right to edit standards, When I save a template with `{{title}}` and `{{owner}}` placeholders, Then it appears in the create dialog and asks for those two values.
- Given a template with instruction text marked as such, When a page is created from it, Then the instruction text is not part of the page.
- Given a template change, Then it travels the same review as any other change to `01-standards/` (a pull request).

### DIS-US-10: Blueprints with an index (S; DIS-33)
As a **Manager** I want a decision log that lists every decision page created from its template, so that I need not maintain the list by hand.
- Given pages created from the *Decision record* blueprint, When I open the decision log page, Then they are listed with status and date, newest first.
- Given a decision page that is archived, Then it is absent from the log unless I choose to include archived pages.

## Version history

### DIS-US-11: See the history of a page (M; DIS-40, DIS-41)
As a **Viewer** (an auditor) I want the list of versions of a page with who changed it, when and why, so that I know what a page said at a date.
- Given a page changed three times, When I open its history, Then I see three versions, newest first, each with date, author, change message and the commit.
- Given a version change made through the portal by a person, Then the author shown is that person and not the service account ([question 3](open-questions.md#q3-page-history-diff-restore-and-authorship)).
- Given I open version 2, Then I see the page exactly as it was, labelled with its commit, and I can open the same text at its commit in the Git server.
- Given the mirror lacks a commit of the history, Then the list says the history is incomplete from that version on and does not guess.

### DIS-US-12: Compare two versions (M; DIS-42)
As a **Member** I want to compare two versions of a page, so that I see what changed before I rely on it.
- Given versions 2 and 4, When I choose both and compare, Then added text is shown as added, removed text as removed and the headings that changed are listed.
- Given a diff that touches a table, Then rows added or removed are shown as such, not only as changed lines.
- Given two identical versions, Then I am told there is no difference.
- Given a page over the size the diff supports, Then I see the changed sections and line counts, as `brain_changes` shows, with the reason.

### DIS-US-13: Restore a version and a deleted page (M; DIS-43, S: DIS-44, DIS-46)
As a **Manager** I want to restore an earlier version, so that a wrong change is undone without losing the history.
- Given version 2 of a page that is now at version 5, When I restore version 2, Then a new version 6 with the text of version 2 is proposed through the project's usual publication path (a pull request unless the space publishes directly), and versions 3 to 5 stay in the history.
- Given the proposal is merged, Then the history shows version 6 with the change message *Restore version 2*.
- Given I hold an unpublished draft of the page, When I restore a version, Then I am warned that the draft will be replaced and I can cancel.
- Given a deleted page, When I open the deleted pages of the space, Then I can restore it from the commit before its deletion, at its former place when that place still exists, else under a parent I choose.

### DIS-US-14: Move a page without losing its history (S; DIS-45)
As a **Member** I want a moved or renamed page to keep its history and its inbound links, so that the history is not split in two.
- Given a page moved to another folder, When I open its history, Then the versions before the move are shown.
- Given another page links to the moved page, Then the link still leads there ([authoring question 5](../10-authoring/feature-matrix.md)).

### DIS-US-15: What changed lately (S; DIS-47)
As a **Member** I want a list of the latest changes in a space, so that I see what my team changed since I last looked.
- Given pages changed over the week, When I open recent updates of a space, Then I see them newest first with author, summary and a link to the comparison with the previous version.
- Given I hold a commit from an earlier reading, When I ask what changed since then, Then I get the documents and sections that changed, the same answer `brain_changes` gives an agent.

## Archive

### DIS-US-16: Archive a page (S; DIS-50, DIS-51)
As a **Manager** I want to archive a page that no longer applies, so that it stops appearing in searches and the tree but is not lost.
- Given a page I may edit, When I archive it, Then it is marked archived in the document repo and leaves the tree and the default search results at the next Brain build.
- Given a page that other pages link to, When I archive it, Then I am shown how many pages link to it before I confirm.
- Given the list of archived pages, When I restore one, Then it returns to the tree under the parent I choose and is searchable again.
- Given an agent searches with the Brain tools, Then archived pages are left out unless the agent asks for them, and a page that is in the results carries its status ([Brain, summaries](../../../reference/brain.md#where-summaries-come-from)).

## Analytics and personal lists

### DIS-US-17: Which knowledge do agents read? (S; DIS-63, C: DIS-60, DIS-62)
As a **Manager** I want to see which pages agents and people read, and which nobody reads, so that I improve the first and archive or rewrite the second.
- Given members' agents read pages over a month, When I open the knowledge report, Then I see pages ranked by reads, with the number of people and agents, and no page text.
- Given a page nobody read in 90 days, Then it appears in a list of candidates for archive.
- Given the retention of activity records is 30 days, Then the report says over which period it counts.
- Given per-person view data is kept, Then a manager sees counts only and an admin setting hides names (the privacy mode of [analytics](feature-matrix.md#analytics)).

### DIS-US-18: Star and revisit pages (S; DIS-70, DIS-71)
As a **Member** I want to star a page and see what I opened lately, so that I return to my pages in one click.
- Given I star a page, When I open my starred list, Then it is there; when I unstar it, Then it is gone.
- Given I opened five pages, When I open recent, Then they are listed newest first, once each.
- Given I lose Project Access to the page's project, Then its entries disappear from my lists.
- Given another member, Then they never see my starred or recent lists.

### DIS-US-19: An agent finds a page by label and status and cites it (M; DIS-02, DIS-03, DIS-06, DIS-14, S: DIS-04, DIS-50)
As an **Agent** I want to search the Brain by words, label and status and read the page I find, so that I answer a member's question from the project's own documents and cite where the answer is.
- Given a project whose Brain is ready, When the agent searches `rollback` with the label `runbook`, Then every hit names its node, its breadcrumb and the matching line, and only pages with that label are returned.
- Given the agent reads a hit, Then the read returns the numbered lines of the page and a citation in the form `path:lines@commit`, and the agent cites only the lines that hold the answer.
- Given a page with `status: archived`, When the agent searches without asking for archived pages, Then it is not returned; when it asks for them, Then the hit carries its status.
- Given the agent's member has no Project Access to the project, Then the search is refused as any other Brain read is, and nothing of the project is revealed.
- Given the Brain holds no page with the words, Then the agent is told so and is expected to say that the Brain does not hold the answer.

### DIS-US-20: An agent asks what changed and who wrote it (S; DIS-40, DIS-42, DIS-47)
As an **Agent** I want the history of a page and the changes since my earlier reading, so that I tell the member whether an answer I gave before still holds.
- Given an earlier citation `01-standards/review-rules.md:10-18@3f2a9c1`, When the agent asks what changed since that commit, Then it receives the documents and sections that changed, with their status (added, modified, deleted, renamed) and line counts, and then reads the changed sections with new citations.
- Given the agent asks for the history of a page, Then it receives a bounded list of versions, newest first, with commit, date, author and change message, and a flag that says when the history is incomplete.
- Given the agent compares two versions of a page, Then it receives the text of the change with context, bounded in size, and a notice when it was cut.
- Given the commit of the earlier citation is not in the mirror, Then the answer says so and does not guess.

## Coverage

| Row | Stories | Row | Stories |
|---|---|---|---|
| DIS-01, 02, 03, 17 | US-01, US-19 | DIS-41 | US-11 |
| DIS-04 | US-03, US-19 | DIS-42 | US-12, US-20 |
| DIS-05, 06 | US-02, US-19 | DIS-43, 44, 46 | US-13 |
| DIS-07, 08, 09 | US-02 | DIS-45 | US-14 |
| DIS-12 | US-05 | DIS-47 | US-15, US-20 |
| DIS-14 | US-04, US-19 | DIS-50, 51 | US-16, US-19 |
| DIS-20, 22 | US-06 | DIS-63 | US-17 |
| DIS-21, 23 | US-07 | DIS-70, 71 | US-18 |
| DIS-30 | US-08 | DIS-31, 32 | US-09 |
| DIS-33 | US-10 | DIS-40 | US-11, US-20 |
