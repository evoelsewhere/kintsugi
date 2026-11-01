# Constraints and fit

> Research page. The architecture constraints a Confluence-like wiki in Kintsugi must respect, the rules the architects derived from them, and a verdict for every Must and Should feature of the three area matrices: **fits**, **fits with a change**, **needs an ADR** or **conflicts**. The target building blocks are in [target architecture](target-architecture.md); the decisions are proposed in ADR-0096 to [ADR-0099](../../../decisions/0099-wiki-collaboration-and-access.md).

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

The three constraint threads of the research (authoring, collaboration, discovery) were decided on these rules. The decisions they lead to are proposed in ADR-0096 (spaces and pages), ADR-0097 (Brain), [ADR-0098](../../../decisions/0098-wiki-page-editing-and-publishing.md) (editing and publishing) and [ADR-0099](../../../decisions/0099-wiki-collaboration-and-access.md) (collaboration and access).

| Id | Rule | From | Why |
|---|---|---|---|
| R-01 | Reviewed page text, front matter (labels, status, owner, page id, order) and attachments are in Git; drafts, comments, watches, notifications, favourites, recents and view counts are in Postgres | C-01, C-06 | Git holds what a reviewer approves; Postgres holds conversation and per-person state that must not need a pull request |
| R-02 | A draft is one Postgres row per person and page with its base commit and the SHA-256 of the file it started from; autosave never reaches the writer | C-05 | The writer handles one write per repository at a time; a commit per keystroke would flood the history and starve runtime writes |
| R-03 | Publishing is one `document-write` of kind `page` carrying `expectedHash`; a pull request is the default, a direct commit needs a path in the new `kintsugi.yaml` key `directPublishPaths` **and** the permission `wiki.publish` | C-05, C-10 | The writer already refuses a file that changed since it was read (`packages/git/src/write.ts:150`); a separate key keeps runtime outputs from riding on wiki globs and pages from riding on bot globs |
| R-04 | When the base moved, the API merges three ways (base, draft, head) before it enqueues; a conflict goes back to the editor with the three texts; a push rejection keeps the writer's fetch-rebase-retry, and a rebase conflict fails the write but keeps the draft | C-05 | Concurrent edits are resolved the way Git resolves them, before the write, where the person can act |
| R-05 | The page tree is the folder tree: the numbered roots are system spaces; team spaces live under a new root `20-spaces/<space>/`; a space's home is its `README.md`; a page with children is a folder with a `README.md` | C-02, C-04 | The Brain already uses a folder's `README.md` as its summary; no second hierarchy can disagree with the folders |
| R-06 | A page has a stable id in front matter (`id: PAGE-<SPACE>-0001`); links in the file are relative Markdown links; a move or rename rewrites the inbound links in the same write | C-03, C-09 | Git servers, the Brain and agents follow standard links only; `[[id]]` would render as text outside the portal |
| R-07 | Macros are Markdown: panels are GitHub alerts (`> [!NOTE]`), dynamic and data macros are fenced blocks with an info string `kintsugi-<macro>` and YAML parameters, stored unexpanded; raw HTML is not rendered | C-03 | Fenced blocks survive every parser and Git viewer verbatim, as `mermaid` does; `:::` directives are not CommonMark |
| R-08 | Attachments are files in `_attachments/` beside the page, from an allowlist of types, within the writer's limits; they are served by a raw route with a fixed content type, `Content-Disposition`, `nosniff` and a content security policy | C-03, C-05, C-06 | No object store and no Git LFS (servers differ); the file route answers 415 for binaries today |
| R-09 | Edit and publish restrictions per space or path prefix are Postgres rules checked by the API on draft and publish; viewing is bounded by Project Access to the whole repository; there is no per-page view restriction on content in Git | C-01, C-02, C-10 | A view rule on Git content is not a control: everyone with Git read access, every member's local clone and every mirror has the text, and each Brain read path would need a filter that can leak |
| R-10 | Notifications are Postgres rows delivered over the change feed (topic `notifications`, scope = the user id) and an inbox page; mail and webhooks are deferred behind their own decision | C-06, C-07, C-11, C-13 | No mail dependency exists today (ADR-0008); an outbound channel stores a credential and needs its own security review |
| R-11 | People's ranked search is a `tsvector` index in the `knowledge` schema built in the Brain's build from the same commit; every hit shows its line and citation | C-06, C-09 | Postgres can rank without a new store; building it with the Brain keeps one commit for tree, links and search |
| R-12 | Page history, compare and restore come from Git on request; a restore is a new write with the old text; the editor's name comes from `workflow.document_write.actor` joined by commit | C-01, C-09 | Git is the version history; the Brain keeps not indexing history |
| R-13 | Export is Markdown (a page, or a folder as a Git archive at a commit) and the browser's print to PDF; a server-side PDF or Word converter is a new image dependency and needs its own decision | C-07 | A headless browser or pandoc adds hundreds of megabytes and an attack surface to the worker image |
| R-14 | The wiki adds no runtime job, no kernel tool and no agent; members' agents read pages through the Brain tools they already have | C-08, C-09 | The engine stays small; the Brain is the agent interface |

## Verdicts

Verdicts: **fits** (works with what exists, perhaps with portal or API work that changes no rule), **fits with a change** (a change of an existing module or contract, named), **needs an ADR** (a new or amended decision, named), **conflicts** (contradicts a constraint; resolved by a proposed ADR or listed under [open questions](#open-questions-for-the-owner)). Only Must and Should rows of each area matrix are listed.

### Authoring

From the authoring matrix (`10-authoring/feature-matrix.md`).

| Id | Feature | MoSCoW | Verdict | Change or ADR |
|---|---|---|---|---|
| AUT-01 | Create a space | M | needs an ADR | ADR-0096: a space is a folder; team spaces under `20-spaces/` in `document-layout.ts` (R-05); creating one is a `page` write of its `README.md` |
| AUT-02 | Space key and address | S | fits with a change | Space key in the home page's front matter; portal routes `/projects/:id/wiki/:space/...` resolve through the Brain's nodes |
| AUT-03 | Space home page | S | fits | The folder's `README.md`, rendered (R-05) |
| AUT-04 | Page tree sidebar | M | fits with a change | The Brain tree (titles and summaries per node) drives the sidebar; the file tree stays for files |
| AUT-05 | Reorder pages | S | needs an ADR | Front matter `order`, honoured by the Brain builder (ADR-0097) |
| AUT-06 | Space directory | S | fits | A list of the space home pages of the project from the Brain |
| AUT-11 | Create a page | M | needs an ADR | ADR-0098: a draft, then a `page` write with `createOnly` |
| AUT-12 | Edit a published page | M | needs an ADR | ADR-0098: draft with base hash, publish with `expectedHash` (R-02, R-03) |
| AUT-13 | Rename a page | M | needs an ADR | ADR-0096 page id; ADR-0098 rename as one write with inbound links rewritten (R-06) |
| AUT-14 | Move a page | M | needs an ADR | As AUT-13; the write contract gains a `delete` (or `move`) entry next to the file list |
| AUT-15 | Copy a page | S | fits with a change | A new draft from the page's text with a new page id |
| AUT-16 | Delete a page | M | fits with a change | The write contract gains file deletion; the writer validates the path like a write; inbound links are reported, not silently broken |
| AUT-17 | Restore or purge | S | fits with a change | Restore = a new write with the text from Git (R-12); purge from history is never offered (C-01) |
| AUT-20 | Markdown source with preview | M | fits | CodeMirror is in the portal (`apps/portal/src/components/code/code-editor.tsx`); side-by-side preview with the existing renderer |
| AUT-21 | Rich-text editing | S | needs an ADR | ADR-0098 allows it only after a byte-for-byte round-trip test over the starter template and a sample repository; until then Markdown source only |
| AUT-24 | Tables | S | fits | GitHub-flavoured tables; a table helper in the editor |
| AUT-25 | Code blocks | M | fits | Syntax colours in the renderer |
| AUT-26 | Diagrams | M | fits | Mermaid already renders |
| AUT-28 | Headings and anchors | S | fits with a change | The renderer gives headings the same anchors as the Brain's node ids |
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

From the collaboration matrix (`20-collaboration/feature-matrix.md`); verdicts are added when it is accepted.

### Discovery and lifecycle

From the discovery matrix (`30-discovery/feature-matrix.md`); verdicts are added when it is accepted.

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
