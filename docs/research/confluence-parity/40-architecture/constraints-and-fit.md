# Constraints and fit

> Research page. The architecture constraints a Confluence-like wiki in Kintsugi must respect, the rules the architects derived from them, and a verdict for every Must and Should feature of the three area matrices: **fits**, **fits with a change**, **needs an ADR** or **conflicts**. The target building blocks are in [target architecture](target-architecture.md); the decisions are proposed in [ADR-0096](../../../decisions/0096-wiki-pages-in-the-document-repo.md) to [ADR-0099](../../../decisions/0099-wiki-collaboration-and-access.md).

## Constraints

Each constraint links the decision that sets it and says in one line what it requires or forbids. The last column says what it means for a wiki.

| Id | Constraint | Decision | Requires or forbids | For the wiki |
|---|---|---|---|---|
| C-01 | Git is the source of truth | [ADR-0007](../../../decisions/0007-git-as-source-of-truth.md) | Documents and their history live in Git; Postgres keeps indexes and operational state only | A page's text, its attachments and its versions are files and commits; Postgres may hold drafts, comments, watches and indexes, never the published text |
| C-02 | One document repository per project | [ADR-0028](../../../decisions/0028-remove-rulebook-single-document-repo.md) | Everything except code in one repository with role `document` | The wiki is that repository; no second wiki repository and no repository per audience |
| C-03 | Markdown only | [ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md) | Documents are Markdown with front matter, tables and cards; readers parse nothing else | A page is a Markdown file; macros must be Markdown; binary attachments need an amendment (ADR-0096) |
| C-04 | Numbered layout, paths in one place | [ADR-0051](../../../decisions/0051-document-repo-layout-legacy-and-modern.md), [document repo](../../../reference/document-repo.md) | Root folders numbered in reading order; every path is built in `packages/domain/src/document-layout.ts` | The page tree is the folder tree; a new root for team spaces is a change of the layout module, not a second hierarchy |
| C-05 | One writer | [ADR-0019](../../../decisions/0019-workspace-repo-write-path.md), [write path](../../../reference/document-repo-write-path.md) | Only the worker's writer commits: validated paths, at most 500 files, 5 MiB per file and 50 MiB per write, one write per repository at a time, fast-forward pushes, `kintsugi/*` branches and pull requests outside `autoCommitPaths` | Every publish, move, delete and restore is one `document-write`; autosave cannot go through the writer queue |
| C-06 | Postgres is the only datastore | [ADR-0010](../../../decisions/0010-postgres-only.md) | No search engine, object store, cache or message broker | Search is a Postgres index; attachments are in Git; presence and notifications use Postgres and the existing change feed |
| C-07 | Self-hosted Compose package | [ADR-0006](../../../decisions/0006-self-hosted-package.md) | One installation, no multi-tenancy, no SaaS dependency, no Kubernetes | No hosted converter, no external notification service; a new container or a heavy dependency in an image needs an ADR |
| C-08 | A small engine | [ADR-0014](../../../decisions/0014-no-code-graph-no-agent-config.md), [ADR-0023](../../../decisions/0023-runtime-as-generic-agent-kernel.md) | No parsers beyond Markdown, no code graph; the runtime knows no use case | The wiki is API, worker-writer and portal work only; it adds no runtime kernel tool and no job |
| C-09 | The Brain is a vectorless tree of one branch | [ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md) | Built without a model from the reviewed branch; no similarity ranking; history not indexed; `restricted/`, `plugins/`, `scratch/` left out | Published pages appear in the Brain after merge only; drafts and comments never; ranked search for people needs an amendment (ADR-0097) |
| C-10 | Identity and access through the permission catalog | [ADR-0008](../../../decisions/0008-authentication.md), [ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md), [ADR-0062](../../../decisions/0062-coding-agent-context-and-project-access.md) | Permission codes are added by migration; access roles grant, project roles never do; Project Access is explicit per project and user, all or nothing | Wiki permissions are new codes; space grants go to users and access roles; a grant never widens Project Access |
| C-11 | Live updates carry no content | [ADR-0059](../../../decisions/0059-live-updates-over-sse.md) | The change feed sends a topic and a scope over SSE; the client refetches | Notifications and presence are new topics; the text is read through the API with its access checks |
| C-12 | DDD module anatomy | [apps/api README](../../../../apps/api/README.md) | `domain`, `application`, `infrastructure`, `interface`; dependencies inward; other modules only through `index.ts`; one schema per domain | A wiki module of its own that uses `documents`, `document-writes` and `brain` through their public surface |
| C-13 | Credentials encrypted and never returned | [ADR-0009](../../../decisions/0009-llm-provider-config.md) | Secrets are stored encrypted with `KINTSUGI_SECRET_KEY` | An outbound mail or webhook channel, if ever added, stores its credential the same way |
| C-14 | Changes are audited | [security concept](../../../architecture/concepts/security.md) | `governance.audit_event` is append-only; restricted reads are audited fail-closed | Grants, restriction changes and comment deletion are audit actions |

## Rules derived for the wiki

The three constraint threads of the research (authoring, collaboration, discovery) were decided on these rules. The decisions they lead to are proposed in [ADR-0096](../../../decisions/0096-wiki-pages-in-the-document-repo.md) (spaces and pages), [ADR-0097](../../../decisions/0097-brain-indexes-wiki-pages.md) (Brain), [ADR-0098](../../../decisions/0098-wiki-page-editing-and-publishing.md) (editing and publishing) and [ADR-0099](../../../decisions/0099-wiki-collaboration-and-access.md) (collaboration and access).

| Id | Rule | From | Why |
|---|---|---|---|
| R-01 | Reviewed page text, front matter (labels, status, owner, page id, a folder's order) and attachments are in Git; drafts, comments, watches, notifications, favourites, recents and view counts are in Postgres | C-01, C-06 | Git holds what a reviewer approves; Postgres holds conversation and per-person state that must not need a pull request |
| R-02 | A draft is one Postgres row per person and page with its base commit and the SHA-256 of the file it started from; autosave never reaches the writer. Files added to an unpublished draft are kept beside it (`knowledge.wiki_draft_attachment`, same allowlist, 5 MiB per file, 20 MiB per draft), shown only in its editor and moved into the write at publish | C-05 | The writer handles one write per repository at a time; a commit per keystroke would flood the history and starve runtime writes. Draft files are working state, bounded and short-lived, never published content |
| R-03 | Publishing is one `document-write` of kind `page` carrying `expectedHash`; a pull request is the default, a direct commit needs a path in the new `kintsugi.yaml` key `directPublishPaths` **and** the permission `wiki.publish` | C-05, C-10 | The writer already refuses a file that changed since it was read (`packages/git/src/write.ts:150`); a separate key keeps runtime outputs from riding on wiki globs and pages from riding on bot globs |
| R-04 | When the base moved, the API merges three ways (base, draft, head) before it enqueues; a conflict goes back to the editor with the three texts; a push rejection keeps the writer's fetch-rebase-retry, and a rebase conflict fails the write but keeps the draft | C-05 | Concurrent edits are resolved the way Git resolves them, before the write, where the person can act |
| R-05 | The page tree is the folder tree: the numbered roots are system spaces; team spaces live under a new root `20-spaces/<space>/`; a space's home is its `README.md`; a page with children is a folder with a `README.md`; the manual order of a folder is an `order:` list in that `README.md`'s front matter | C-02, C-04 | The Brain already uses a folder's `README.md` as its summary; no second hierarchy can disagree with the folders |
| R-06 | A page has a stable id in front matter (`id: PAGE-<KEY>-0001`); links in the file are relative Markdown links; a move or rename rewrites the inbound links in the same write | C-03, C-09 | Git servers, the Brain and agents follow standard links only; `[[id]]` would render as text outside the portal |
| R-07 | Macros are Markdown: panels are GitHub alerts (`> [!NOTE]`), dynamic and data macros are fenced blocks with an info string `kintsugi-<macro>` and YAML parameters, stored unexpanded; raw HTML is not rendered | C-03 | Fenced blocks survive every parser and Git viewer verbatim, as `mermaid` does; `:::` directives are not CommonMark |
| R-08 | Attachments are files in `_attachments/` beside the page, from an allowlist of types, within the writer's limits; they are served by a raw route with a fixed content type, `Content-Disposition`, `nosniff` and a content security policy | C-03, C-05, C-06 | No object store and no Git LFS (servers differ); the file route answers 415 for binaries today |
| R-09 | Edit and publish restrictions per space or path prefix are Postgres rules checked by the API on draft and publish; viewing is bounded by Project Access to the whole repository; there is no per-page view restriction on content in Git | C-01, C-02, C-10 | A view rule on Git content is not a control: everyone with Git read access, every member's local clone and every mirror has the text, and each Brain read path would need a filter that can leak |
| R-10 | Notifications are Postgres rows delivered over the change feed (topic `notifications`, scope = the user id) and an inbox page; mail and webhooks are deferred behind their own decision | C-06, C-07, C-11, C-13 | No mail dependency exists today (ADR-0008); an outbound channel stores a credential and needs its own security review |
| R-11 | People's ranked search is a `tsvector` index in the `knowledge` schema built in the Brain's build from the same commit; every hit shows its line and citation | C-06, C-09 | Postgres can rank without a new store; building it with the Brain keeps one commit for tree, links and search |
| R-12 | Page history, compare and restore come from Git on request; a restore is a new write with the old text; the editor's name comes from `workflow.document_write.actor` joined by commit | C-01, C-09 | Git is the version history; the Brain keeps not indexing history |
| R-13 | Export is Markdown (a page, or a folder as a Git archive at a commit) and the browser's print to PDF; a server-side PDF or Word converter is a new image dependency and needs its own decision | C-07 | A headless browser or pandoc adds hundreds of megabytes and an attack surface to the worker image |
| R-14 | The wiki adds no runtime job, no kernel tool and no agent; members' agents read pages through the Brain tools they already have | C-08, C-09 | The engine stays small; the Brain is the agent interface |
| R-15 | The wiki never edits `_generated/`, `restricted/`, `plugins/`, `scratch/`, hidden folders or `identifiers/`; documents written by jobs show a banner and always go by pull request; one predicate in `packages/domain/src/document-layout.ts` beside the Brain's indexed-path rule | C-04, C-05 | A hand edit of a ledger breaks id allocation ([ADR-0075](../../../decisions/0075-compact-stable-document-reference-ids.md)); generated views are rewritten by their jobs |
| R-16 | One heading slug function serves the Brain's node anchors, the portal's heading ids and the link checker | C-09 | A link shared from the Brain must open the same place in the portal |

## Verdicts

Verdicts: **fits** (works with what exists, perhaps with portal or API work that changes no rule), **fits with a change** (a change of an existing module or contract, named), **needs an ADR** (a new or amended decision, named), **conflicts** (contradicts a constraint; resolved by a proposed ADR or listed under [open questions](#open-questions-for-the-owner)). Only Must and Should rows of each area matrix are listed.

### Authoring

From the [authoring matrix](../10-authoring/feature-matrix.md).

| Id | Feature | MoSCoW | Verdict | Change or ADR |
|---|---|---|---|---|
| AUT-01 | Create a space | M | needs an ADR | ADR-0096: a space is a folder; team spaces under `20-spaces/` in `document-layout.ts` (R-05); creating one is a `page` write of its `README.md` |
| AUT-02 | Space key and address | S | fits with a change | Space key in the home page's front matter; portal routes `/projects/:id/wiki/:space/...` resolve through the Brain's nodes |
| AUT-03 | Space home page | S | fits | The folder's `README.md`, rendered (R-05) |
| AUT-04 | Page tree sidebar | M | fits with a change | The Brain tree (titles and summaries per node) drives the sidebar; the file tree stays for files |
| AUT-05 | Reorder pages | S | needs an ADR | An `order:` list in the folder's `README.md`, honoured by the Brain builder (ADR-0097); a reorder is a one-file write |
| AUT-06 | Space directory | S | fits | A list of the space home pages of the project from the Brain |
| AUT-11 | Create a page | M | needs an ADR | ADR-0098: a draft, then a `page` write with `createOnly` |
| AUT-12 | Edit a published page | M | needs an ADR | ADR-0098: draft with base hash, publish with `expectedHash` (R-02, R-03) |
| AUT-13 | Rename a page | M | needs an ADR | ADR-0096 page id; ADR-0098 rename as one write with inbound links rewritten (R-06) |
| AUT-14 | Move a page | M | needs an ADR | As AUT-13; the write contract gains `delete` and `rename from` entries with `expectedHash`; a move above 500 files is refused with the count |
| AUT-15 | Copy a page | S | fits with a change | A new draft from the page's text with a new page id |
| AUT-16 | Delete a page | M | fits with a change | The write contract gains file deletion; the writer validates the path like a write; inbound links are reported, not silently broken |
| AUT-17 | Restore or purge | S | fits with a change | Restore = a new write with the text from Git (R-12); purge from history is never offered (C-01) |
| AUT-19 | Page properties | S | fits with a change | Title, status and owner from front matter; last change, date and message from the Brain node's last commit; the editor's name from `workflow.document_write.actor` (R-12) |
| AUT-20 | Markdown source with preview | M | fits | CodeMirror is in the portal (`apps/portal/src/components/code/code-editor.tsx`); side-by-side preview with the existing renderer |
| AUT-21 | Rich-text editing | S | needs an ADR | ADR-0098 allows it only after a byte-for-byte round-trip test over the starter template and a sample repository; until then Markdown source only |
| AUT-24 | Tables | S | fits | GitHub-flavoured tables; a table helper in the editor |
| AUT-25 | Code blocks | M | fits | Syntax colours in the renderer |
| AUT-26 | Diagrams | M | fits | Mermaid already renders |
| AUT-28 | Headings and anchors | S | fits with a change | One exported `headingSlug` (today `brainAnchor`, `packages/domain/src/brain.ts`) for the Brain, the renderer and the link checker (R-16) |
| AUT-31 | Autosave a draft | M | needs an ADR | ADR-0098: `knowledge.wiki_draft` (R-02) |
| AUT-32 | Drafts list | S | needs an ADR | ADR-0098: a person's draft rows |
| AUT-33 | Explicit publish | M | needs an ADR | ADR-0098: pull request by default, direct publish by path and permission (R-03) |
| AUT-34 | Conflict detection | M | fits with a change | `expectedHash` exists; the three-way merge before the write is new (R-04) |
| AUT-36 | Publish message | S | fits | The write's message is the commit message and the pull-request title |
| AUT-37 | Info, tip, note and warning panels | M | needs an ADR | ADR-0098: GitHub alerts (R-07); the renderer learns them |
| AUT-38 | Table of contents | S | fits with a change | Fenced `kintsugi-toc` rendered from the page's headings (R-07) |
| AUT-41 | Listing macros | S | fits with a change | Fenced `kintsugi-children` rendered from the Brain's children of the node (R-07) |
| AUT-44 | Attach a file to a page | M | needs an ADR | ADR-0096 amends ADR-0042 for `_attachments/`; ADR-0098: the API's write type carries base64 like the worker's (R-08) |
| AUT-45 | Insert an image | M | needs an ADR | As AUT-44, plus the raw route that serves an attachment safely (R-08) |
| AUT-46 | Manage the attachments of a page | S | fits with a change | A list of the page's `_attachments/` folder; delete and replace are writes |
| AUT-48 | Size and type limits | S | fits | The writer's limits (5 MiB per file, 50 MiB per write) and the type allowlist (R-08) |
| AUT-49 | Link to a page by title | M | fits with a change | A `[[` picker over the Brain's titles that inserts a relative link (R-06) |
| AUT-50 | Link to a heading | M | fits with a change | Anchors as in AUT-28 |
| AUT-51 | Link to an attachment | S | fits with a change | A relative link into `_attachments/` |
| AUT-52 | Backlinks | S | fits | `knowledge.brain_link` in both directions |
| AUT-53 | Broken-link check | M | needs an ADR | ADR-0097: the Brain records the links it cannot follow instead of dropping them |
| AUT-54 | Link integrity on move, rename and delete | M | needs an ADR | ADR-0098: inbound links rewritten in the same write (R-06) |
| AUT-55 | Export a page to PDF | S | fits | The browser's print with a print stylesheet; server PDF deferred (R-13) |
| AUT-58 | Export as Markdown | M | fits | The file route already returns the source |
| AUT-59 | Import a Word document | S | fits with a change | A pure JavaScript converter in the API (no new image dependency) into a draft; untrusted input, so it gets a security review and size limits |
| AUT-60 | Import Markdown and HTML | S | fits with a change | Markdown becomes a draft as is; HTML is converted to Markdown in the API and sanitized |

### Collaboration and access

From the [collaboration matrix](../20-collaboration/feature-matrix.md).

| Id | Feature | MoSCoW | Verdict | Change or ADR |
|---|---|---|---|---|
| COL-01 | Page comments with replies | M | needs an ADR | ADR-0099: `knowledge.wiki_comment` rows, never in Git (R-01) |
| COL-02 | Inline comments anchored to text | M | needs an ADR | ADR-0099: anchor = page id, Brain node id, quote, commit; re-anchored by the quote, *orphaned* when it is gone |
| COL-03 | Resolve and reopen inline comments | S | fits with a change | A state on the comment row |
| COL-04 | Edit and delete comments | S | fits with a change | Authors edit theirs and delete them while they have no replies; moderation with `wiki.manage`, audited |
| COL-07 | Comments by agents and about agents | S | needs an ADR | ADR-0099: a read-only member tool `comments_list`; the member API stays read-only ([ADR-0069](../../../decisions/0069-common-member-base-and-plugin-distribution.md)) |
| COL-08 | @mention a person | M | needs an ADR | ADR-0099: `@username` in page text, the user id in comments |
| COL-09 | Notify on the first mention only | S | fits with a change | The Brain build compares the mentions of a page between two indexed commits |
| COL-10 | A mention never reveals a page to someone without access | M | fits | Only people with Project Access are told; a notification holds no text (C-11) |
| COL-13 | Watch a page or a space | M | needs an ADR | ADR-0099: `knowledge.wiki_watch` on a page, folder or space |
| COL-14 | Autowatch | S | fits with a change | Publishing or commenting adds a watch row |
| COL-15 | In-app notification inbox | M | needs an ADR | ADR-0099: `core.notification`, change-feed topic `notifications` (R-10) |
| COL-17 | Notification preferences and watch list | S | fits with a change | Preference rows per person; the watch list is a read of the watch rows |
| COL-18 | Notifications respect view permission | M | fits | Recipients are checked for Project Access when the row is made and when it is read |
| COL-19 | Share a page with a person | S | fits with a change | A notification with a link and a note; never a grant (C-10) |
| COL-22 | Three-level model | M | fits with a change | Global = the permission catalog; space and content = edit rules on path prefixes; the view level is Project Access only (R-09, OQ-1) |
| COL-23 | Space permissions and roles | M | conflicts (view part) | Edit and publish per space: ADR-0099 edit restrictions. View per space conflicts with C-01 and C-02; resolved by ADR-0099 (no view restriction on Git content) and OQ-1 |
| COL-24 | Per-operation space permissions | S | needs an ADR | ADR-0099: `wiki.comment`, `wiki.write`, `wiki.publish`, `wiki.manage` by migration |
| COL-25 | Page edit restriction | M | needs an ADR | ADR-0099: an edit restriction on the page's path |
| COL-27 | Restricted pages as encrypted records | S | conflicts | Published text outside Git (C-01); its own decision later (OQ-1) |
| COL-28 | Restrictions only narrow | M | fits | Rules on a subtree and on a child must both be satisfied; no rule widens Project Access |
| COL-29 | List restricted content in a space | S | fits with a change | A list of the edit restrictions under a prefix, for `wiki.manage` |
| COL-31 | Group grants | S | fits | Access roles are the groups ([ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md)); no second grouping concept |
| COL-33 | Presence on a page | S | fits with a change | Draft rows touched in the last two minutes (ADR-0098) |
| COL-34 | Conflict handling on concurrent edits | M | needs an ADR | ADR-0098: three-way merge before the write, `expectedHash` in the writer (R-04) |
| COL-35 | Page approvals | S | fits | The pull request is the approval; named approvers are the Git server's reviewers; a gate per space would need its own decision |
| COL-36 | Version history shows who changed what | S | fits with a change | R-12: `workflow.document_write.actor`; the watch step records the merge commit |
| COL-37 | Audit of permission and restriction changes | M | fits with a change | New actions in `governance.audit_event` (C-14) |
| COL-38 | Audit of reads of sensitive pages | S | conflicts | Only meaningful with COL-27; the fail-closed `restricted.read` pattern exists for it |

### Discovery and lifecycle

From the [discovery matrix](../30-discovery/feature-matrix.md).

| Id | Feature | MoSCoW | Verdict | Change or ADR |
|---|---|---|---|---|
| DIS-01 | Search box across spaces | M | fits with a change | One project's index per query; across projects, the projects the person has Project Access to, bounded |
| DIS-02 | Words in title and body, phrases | M | needs an ADR | ADR-0097: the `tsvector` index (R-11); `brain_grep` stays the exact path |
| DIS-03 | Excerpt with highlights and location | M | fits with a change | A headline from the index or the grep line, with `path:lines@commit` |
| DIS-04 | Ranked results | S | needs an ADR | ADR-0097, amending ADR-0091's "not the primary path" for people's search only |
| DIS-05 | Filter by space | M | fits with a change | A path-prefix filter |
| DIS-06 | Filter by label | M | needs an ADR | ADR-0097: labels kept on Brain nodes |
| DIS-07 | Filter by contributor or creator | S | fits with a change | Last editor from the node's last commit and `document_write.actor`; every contributor needs a Git log per document, so only on a page's history |
| DIS-08 | Filter by content type | S | fits with a change | Front matter `type` (page, template) and comments as their own index |
| DIS-09 | Filter by date | S | fits with a change | The node's last commit date |
| DIS-12 | Search comments | S | fits with a change | A `tsvector` on `knowledge.wiki_comment` |
| DIS-14 | Results respect who may see what | M | fits with a change | Project Access per request (OQ-5); nothing in Git is view-restricted (R-09) |
| DIS-17 | Titles only, recently updated first | S | fits | `brain_lookup` and node titles, sorted by last commit |
| DIS-20 | Add and remove labels | M | fits with a change | A front matter edit published as a page write (ADR-0098); by pull request unless the path allows direct publication |
| DIS-21 | Label page | M | needs an ADR | ADR-0097: the label index |
| DIS-22 | Label naming rules | M | fits with a change | One validator in `packages/domain`, used by the editor, the publish path and the Brain builder |
| DIS-23 | Content by label in a page | S | fits with a change | Fenced `kintsugi-labels` macro (R-07) |
| DIS-30 | Create a page from a template | M | fits with a change | The template's text becomes a draft; it is not linked afterwards |
| DIS-31 | Space and site templates | S | fits | `01-standards/page-templates/` and `<space>/_templates/`, front matter `type: template` |
| DIS-32 | Template variables | S | fits with a change | Placeholders filled in the editor before the draft is saved |
| DIS-33 | Blueprints with an index page | S | fits with a change | A template plus a `kintsugi-labels` index macro |
| DIS-40 | Page history | M | fits with a change | `documents/history` from the mirror (R-12) |
| DIS-41 | View an older version | M | fits | `documents/file?ref=<commit>` exists |
| DIS-42 | Compare two versions | M | fits with a change | `documents/diff` and a rendered diff in the portal |
| DIS-43 | Restore a version | M | fits with a change | A new page write with the old text; the history is kept (C-01) |
| DIS-44 | Restore warns about a draft | S | fits | The person's draft row is known |
| DIS-45 | History survives a move | S | fits with a change | One commit per move so Git detects the rename; `log --follow` |
| DIS-46 | Trash and restore | S | fits with a change | Deleted pages from `git log --diff-filter=D`; restore is a write. Purging versions conflicts with C-01 and is not offered |
| DIS-47 | Recent changes feed | S | fits | `brain_changes` and the Git log of a folder |
| DIS-50 | Archive a page | S | needs an ADR | Front matter `status: archived`; ADR-0097 leaves archived pages out of the default tree and search |
| DIS-51 | List and restore archived pages | S | fits with a change | A filter on `status`; restore is a front matter write |
| DIS-63 | Agent reads count as readers | S | fits with a change | `brain.read` member activity is recorded already ([ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md), decision 6); aggregate it per node |
| DIS-70 | Star a page | S | fits with a change | `knowledge.wiki_favourite` |
| DIS-71 | Recently viewed and worked on | S | fits with a change | `knowledge.wiki_recent` for views, the person's writes for work |

## Open questions for the owner

Conflicts that no proposed decision resolves, and choices that need the owner.

| Id | Question | Why it is open | Proposal |
|---|---|---|---|
| OQ-1 | Page and space **view** restrictions | Conflicts with C-01 and C-02: a rule in Kintsugi cannot hide text that every Git reader and every member's clone has (R-09) | Edit restrictions only in the first phases; content that some project members must not see is stored, in a later phase, as encrypted *restricted pages* in Postgres (an extension of restricted records: `restricted.read`, fail-closed audit, never in Git or the Brain), behind its own decision |
| OQ-2 | Real-time co-editing | A CRDT or OT service (for example Yjs over WebSocket) is new infrastructure and makes the browser hold the truth during a session (C-01, C-06) | Won't in this research; presence markers and the three-way merge cover concurrent edits (R-04) |
| OQ-3 | Server-side PDF and Word export | Needs pandoc or a headless browser in the worker image (C-07) | Browser print first; its own decision if people need server export |
| OQ-4 | Mail and webhook notifications | An outbound dependency with a stored credential (C-07, C-13) | In-portal inbox first (R-10); its own decision |
| OQ-5 | Project Access on the portal's document routes | Today these routes need a session only (`apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`), while the member API and the Brain's member reads check Project Access | A prerequisite of the wiki, not a wiki feature: the documents and wiki read routes check Project Access like the member API |
| OQ-6 | Large binaries | Git repositories grow with every version of a binary; Git LFS is not available on every server Kintsugi supports | The writer's 5 MiB per file and a type allowlist (R-08); larger files stay outside the wiki |
