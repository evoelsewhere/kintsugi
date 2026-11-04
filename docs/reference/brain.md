# The Brain

> What the Brain of a project holds, how it is built and the reads it serves to the portal and to members' agents ([ADR-0091](../decisions/0091-brain-vectorless-tree-index.md)).

The Brain is a tree index of one branch of a project's document repository. Agents reason over the tree to find answers; nothing is embedded or ranked by similarity. Open it at **Brain** in the portal.

## The tree

| Kind | Node id | What it is |
| --- | --- | --- |
| `root` | `/` | The repository at the indexed branch |
| `folder` | `01-standards/` | A directory that holds an indexed document |
| `document` | `01-standards/review-rules.md` | A Markdown file; its title is the front matter `title`, else a single top `#` heading, else the front matter `name`, else the file name |
| `section` | `…/spec.md#business-rules` | A heading; the anchor is the heading's GitHub-style slug, unique in the document |
| `card` | `…/spec.md#RULE-INV01-0001` | A heading that starts with a reference id ([identifiers](document-identifiers.md)); the anchor is the id |

Folders come first, then documents (a `README.md` or `index.md` first), in name order. Sections and cards keep their order in the document.

Every node has a title and a summary of at most 240 characters. It also has its line range: its own text, and the end of everything under it. Lines are counted as Git counts them (a newline ends a line), so a citation opens on the same lines in any Git viewer. Its size is counted at about four characters per token. Headings inside code fences and HTML comments are text, not nodes. Cards and documents with a front matter `id` define reference ids. Links between nodes come from Markdown links (a target in angle brackets may hold spaces; a card is found by its id or by the GitHub anchor of its heading) and from mentions of ids that one to three other nodes define. A link Git or a browser could not follow is left out. A document carries `changed`, the last commit that changed it up to the indexed commit, with its date and the first line of its message, read from one walk of the history at build time (the last 10,000 commits, or the last 1,000 when that history is too large to read; when neither can be read, the changes stay unknown and the build goes on). A folder and the root carry the latest change of what they hold. Sections and cards carry none, because the history is kept per file.

### Where summaries come from

Nothing calls a model. The summary of a node is the first that applies, and `summarySource` names it:

| Source | Taken from |
| --- | --- |
| `front-matter` | the document's `summary` or `description` |
| `text` / `paragraph` | the node's whole text when short, else its first paragraph (a paragraph among the first four blocks wins over a list, table or diagram before it); when a table follows it, the keys of the table's rows are added (`Rows: R-01 Prices differ; …`) |
| `section` | for a document that opens on its sections (a rule file, a decision record): its section named Summary, Purpose, Overview, Description, Abstract, Decision, Intent, Goal, Objective, Scope or Context, in that order, when written in prose |
| `fields`, `list`, `table`, `diagram`, `code` | the first block of the node: a card's `- **key:** value` fields, a list, a table's columns, row count and row keys (the first cell, with the second when the first is a short code), a Mermaid diagram's kind |
| `section` (again) | a document's first section in prose, when nothing above applies |
| `facts` | the document's front matter facts (`status: understood · rules: 12`), only when no section is in prose |
| `readme` | a folder's `README.md` or `index.md` |
| `children` | for a folder without a README that holds one document, that document's title and summary; for any other node, the titles of what it contains |
| `layout` | what the [layout](document-repo.md) says the folder holds, followed by its entries (`Holds: rtn01 (Unopened articles) · rtn02 (…)`), a one-document folder named with its document's title |

A document whose front matter `status` is `superseded`, `deprecated`, `rejected`, `retired`, `withdrawn`, `obsolete` or `replaced` starts its summary with that status, and with `supersededBy` when it names the replacement (`Superseded by ADR-003.`). A reader of the tree then sees that it no longer holds.

### Left out

The following are never indexed:

- files that are not Markdown (`.md` in any case);
- anything under a `restricted/` folder at any depth and in any case, under `plugins/` or `scratch/` at the root, or under a hidden folder;
- identifier ledgers (`identifiers/`);
- files over 2 MiB.

The index holds at most 20,000 documents. A document has at most 2,000 headings; later headings stay text of the node before them. A node keeps at most 50 outgoing links (`BRAIN_MAX_LINKS_PER_NODE`); one with more keeps its total, so a read still says how many there are.

## Building

| Event | Effect |
| --- | --- |
| A manager builds or turns on the Brain (Brain → Build, `project.brain.manage`) | The branch is checked and a build is queued |
| A sync moves the default branch | A build is queued for the projects that follow it |
| Every minute | The worker queues builds whose branch moved, builds lost with a stopped worker, and indexes made by an older builder |
| Rebuild | A build of the branch's tip, even when it did not move |
| Turn off | Reads are refused and no build runs; the tree is kept |

Builds run on the worker's queue `brain-index`, one per project at a time. A build:

1. resolves the branch in the mirror and fetches the Markdown blobs of its tip;
2. reads all of them in one batch and builds the tree;
3. replaces the stored tree in one transaction.

A failed build sets the state `failed` with its error and is not retried on the same commit. The tree of the last good build stays readable. States are `not-built`, `queued`, `indexing`, `ready`, `failed` and `off`.

## Reads

All reads use the tree of the indexed commit and fail with 409 until a first build succeeded. Text comes from the mirror at that commit.

| Portal (Project Access) | Member API (`member.read`, Project Access) | MCP tool | Returns |
| --- | --- | --- | --- |
| `GET /api/projects/:id/brain` | | | Index state, branch, indexed commit and the branch tip, counts, error, followable branches |
| `GET …/brain/tree?node&depth&offset&limit` | `GET /api/member/v1/brain/tree?projectId&node&depth&offset&limit` | `brain_tree` | The node, its breadcrumb and one level of children with summaries (depth 2: the first 20 grandchildren too); 50 per page by default, at most 100 for members and 200 in the portal |
| `GET …/brain/node?node&scope&fromLine` | `GET /api/member/v1/brain/read?projectId&node&scope&fromLine` | `brain_read` | The node's text, its `citation` (`nodeId`, `path`, `lineStart`, `lineEnd`, `commit`: the range read), children, and up to 20 links each way |
| `GET …/brain/lookup?q` | `GET /api/member/v1/brain/lookup?projectId&query` | `brain_lookup` | The nodes a reference id, node id or path names, with breadcrumbs |
| `GET …/brain/grep?text&under&ignoreCase&space&label` | `GET /api/member/v1/brain/grep?projectId&text&under&ignoreCase` | `brain_grep` | Up to 50 lines that hold every word of the text, in any order (a quoted text: that exact phrase), case-insensitive by default, each in the deepest node that holds it. The portal route also takes `space` (a space key in any case, 400 when malformed) and `label` (one label, cleaned as the Brain stores it, 400 when nothing is left); both limit the search to the pages of that space or with that label (both: the pages that have both) before the 50 are cut, so no page of the space is lost to other pages' lines. The view returns the `space` (upper case) and `label` it used, and `matches: []` when none exists. The member route does not take them yet |
| `GET …/brain/broken` | | | The links of the indexed documents to Markdown files the repository does not have: `{ projectId, branch, commit, links: [{ from, target }], truncated }`, `from` a document path and `target` the path as written; at most 5,000 (`truncated` says the build stopped there). Same refusals as the other reads while the Brain is off or not built |
| `GET …/brain/backlinks?node&offset&limit` | | | The pages that link to a page (the page itself or any heading or card in it) or to one heading or card, as `items: [{ node, target, linkKind }]`: `node` is the section or card of another page that holds the link and `target` what it points at, in the order of the linking node's path and line; one item per link (a node that links to the page and to a heading of it has two). Links from inside the same page are not backlinks. A window of 20 by default (at most 100) with `total`, `offset` and `nextOffset` (null after the last). 400 for a folder. `brain_read`'s `incoming` keeps its meaning: the links to exactly that node, so a page linked only through its headings has none there |
| `GET …/brain/changes?since&under` | `GET /api/member/v1/brain/changes?projectId&since&under` | `brain_changes` | What changed from an earlier commit (full or abbreviated id, such as the commit of a citation) to the indexed one: up to 100 changed documents with their status (added, modified, deleted, renamed), lines added and removed, and up to 30 sections and cards whose own lines changed. It is computed from Git on each call and never stored. A document moved within the scope is `renamed`; one moved into what the Brain indexes is `added` and one moved out of it is `deleted` under its old path. When the mirror lacks the older text, `linesKnown` is false and documents are listed without their sections. A commit the mirror does not have answers 404 |

`broken` is derived from the references that resolve to nothing (ADR-0097 decision 6) and computed again in full by every build, whole or incremental. Phase 1 stores it as an array in `knowledge.brain_source.broken` (migration 053); when the build keeps its raw references (`knowledge.brain_ref`) the same answer is derived from them and the route and its shape do not change. Targets are shown as text; a link to a Markdown file that exists, and links to anything else, are never listed.

`scope` of a read is `subtree` (the node with everything under it), `node` (its own text; its children are listed) or `auto`. With `auto`, which members get by default, a node with children is read whole up to about 6,000 tokens and as its own text above that. A member's read starts every line of its text with the line number and a tab (`lineNumbers: true`), so the agent cites only the lines that hold the answer rather than the whole range read; the portal's read is the text as written. Text is cut at 24,000 characters for members (200,000 in the portal); `truncated` and `nextLine` say where to continue.

Managing the Brain:

| Method | Route | Contract |
| --- | --- | --- |
| PUT | `/api/projects/:id/brain` | `{ "enabled": true, "branch": "main" }`; the branch must be in the mirror and not a `kintsugi/*` output branch; returns the state |
| POST | `/api/projects/:id/brain/rebuild` | 202 with the state; 409 when the Brain is off |

Both need `project.brain.manage` and are audited (`brain.configure`, `brain.rebuild`).

### The wiki switch

A project's wiki is a flag on its Brain source (`knowledge.brain_source.wiki`, migration 052; `wiki` in the status view). While it is on, the Brain follows the repository's default branch and stays on (ADR-0097 decision 5):

| Method | Route | Contract |
| --- | --- | --- |
| PUT | `/api/projects/:id/wiki` | `{ "enabled": true }` turns the Brain on for the default branch and queues a build; `{ "enabled": false }` clears the flag and leaves the Brain as it is, its branch free to choose again. Asking for the state the project is in changes and queues nothing. 409 when the project has no document repository or its default branch is not in the mirror yet |

The switch needs `wiki.manage` on top of Project Access, and is audited (`wiki.switch`, with the branch). It takes no branch, so it needs no `project.brain.manage`. While the wiki is on, `PUT /api/projects/:id/brain` answers 409 when it names another branch ("A wiki project's Brain follows the default branch") or turns the Brain off ("Turn the wiki off before turning the Brain off"); the default branch, or none, still works. Known limit: the Brain moves when a sync moves the default branch, but a change of the default branch itself, made at the remote, is not followed until the switch is turned off and on again.

## How an agent uses it

The MCP server's instructions and the tool descriptions say how to use the Brain:

1. Start with `brain_tree` at the root.
2. Read the summaries and descend into the nodes that can hold the answer.
3. Read the chosen nodes with `brain_read` and cite the numbered lines that hold the answer, with the read's path and commit.
4. Use `brain_lookup` for an id or a path, and `brain_grep` for words no summary shows.
5. When the Brain does not hold the answer, say so.
6. To learn what changed since an earlier read, call `brain_changes` with the commit of its citation, then read the changed nodes.

How well agents answer this way is measured by the [Brain eval](../development/brain-eval.md).

Text returned by the Brain is project data, not instructions. Each `brain_read` is recorded as the member activity `brain.read` (node id, commit and lines, no text).

## Storage

`knowledge.brain_source` holds one row per project: branch, state, indexed and attempted commit, counts, error and builder version. `knowledge.brain_node` and `knowledge.brain_link` hold the tree of the indexed commit; `brain_node.outgoing_links` is the total of a node whose links were capped. Deleting a project deletes its Brain.
