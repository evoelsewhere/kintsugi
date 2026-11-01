# Scope and priorities of a Confluence-like wiki in Kintsugi

> Research, not a decision. This page says what "Confluence-like" must mean for Kintsugi's users, what is out of scope, the principles every proposal in this pack respects, and the priority (MoSCoW) of every feature. The decisions it leads to are proposed in ADR-0096 to ADR-0099.

## The question

Kintsugi already keeps everything about a project except its code in one document repository ([ADR-0007](../../decisions/0007-git-as-source-of-truth.md)): Markdown with front matter, tables and cards ([ADR-0042](../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)), in folders numbered in reading order ([ADR-0051](../../decisions/0051-document-repo-layout-legacy-and-modern.md)). The portal shows it, the Brain indexes it as a tree that agents and people reason over ([ADR-0091](../../decisions/0091-brain-vectorless-tree-index.md)), and the worker's writer commits to it ([ADR-0019](../../decisions/0019-workspace-repo-write-path.md)). What it lacks is what teams use a wiki such as Confluence for: writing and reorganising pages in the browser, discussing them, being told when they change, finding them by label or search, starting them from templates and seeing their history.

The goal of this research is to say how Kintsugi would offer that feature set **on top of what it has**, and how it fits with the Brain.

## What "Confluence-like" means here

A **project wiki over the document repository**: every page is a Markdown document in Git, and the portal lets the people of a project browse it as a page tree, read it rendered, edit it, comment on it, watch it, label it, search it, start it from a template and see its history, while the Brain serves the same pages to members' agents with citations.

It does not mean a second content store, a copy of Confluence's storage format or a general-purpose intranet. Where Confluence and Git disagree, Git wins: a page's text and its history are what the repository says.

## Who it serves

| Persona | Who | What they need from the wiki |
|---|---|---|
| `member` | a person working on a project (analyst, architect, developer, tester) | write and fix pages in the browser without a Git client, discuss a passage, and be told when a page they rely on changes |
| `manager` | the project manager or a lead with management permissions on the project | organise the page tree, set who may read or change which part, start pages from the project's templates, see what changed and who is behind on a review |
| `admin` | the administrator of a self-hosted installation | grant access through the existing access roles and permission catalog, keep the installation on its one Postgres and Git, audit who changed or read restricted content |
| `viewer` | a stakeholder with read access to a project and no right to change it (an access role such as `user`, [ADR-0024](../../decisions/0024-access-roles-vs-project-roles.md)) | find and read pages, follow links and labels, and comment where allowed |
| `agent` | a member's agent (Claude Code, Copilot, ChatGPT/Codex) reading through the member API and the local MCP bridge ([ADR-0069](../../decisions/0069-common-member-base-and-plugin-distribution.md)) | navigate the same pages through the Brain, find them by label, link or exact text, and cite `path:lines@commit` |

## In scope

The twelve feature areas of the goal, each researched by one business analyst:

| Area | Features | Research |
|---|---|---|
| Authoring | spaces and the page tree; create, edit, move, copy, delete; the editor (tables, code, Mermaid diagrams); macros and embeds; attachments and images; links and backlinks; drafts and autosave; export and import | [10-authoring](10-authoring/README.md) |
| Collaboration and access | page and inline comments; mentions; watching and notifications; co-editing versus Git review; approvals; sharing; space and page permissions and restrictions; audit | [20-collaboration](20-collaboration/feature-matrix.md) |
| Discovery and lifecycle | search and filters; labels; templates and blueprints; version history, compare and restore; archive and trash; analytics; recently viewed and favourites | [30-discovery](30-discovery/README.md) |
| Architecture | the data model on Git and Postgres, the Brain integration, the target building blocks and the fit with Kintsugi's constraints | [40-architecture](40-architecture/target-architecture.md) |

## Out of scope

| Excluded | Why |
|---|---|
| Real-time co-editing of one page by several people at once (collaborative cursors, operational transform or CRDT) | It needs a live document service and makes the browser, not Git, the holder of the truth for the duration of a session ([ADR-0007](../../decisions/0007-git-as-source-of-truth.md)); edits from the portal become commits, and concurrent edits are resolved as Git resolves them. The collaboration research records it as a later option, not a goal. |
| Confluence's rich storage format (XHTML with macros) and a WYSIWYG model that is not Markdown | The repository holds Markdown only ([ADR-0042](../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)); anything an editor offers must round-trip to Markdown. |
| Several tenants, organisations or sites per installation, and public anonymous pages | Kintsugi is one self-hosted installation without multi-tenancy ([ADR-0006](../../decisions/0006-self-hosted-package.md)); every reader signs in ([ADR-0008](../../decisions/0008-authentication.md)). |
| An app marketplace, third-party macros and a plugin runtime in the page | Kintsugi's extension point is the Claude Code plugin format for agents ([ADR-0035](../../decisions/0035-kintsugi-plugins-marketplace.md)); running third-party code in the portal is a different product and a security risk. |
| Whiteboards, databases, video, calendars and blog posts | Not part of the project documentation Kintsugi manages; Mermaid diagrams cover the diagrams a page needs. |
| Built-in generative AI in the editor (write, summarise, answer) | Kintsugi calls no model at query time for the Brain; members bring their own agents ([ADR-0091](../../decisions/0091-brain-vectorless-tree-index.md), [ADR-0069](../../decisions/0069-common-member-base-and-plugin-distribution.md)). |
| A new datastore (search engine, object store, cache) | Postgres is the only datastore and Git the source of truth ([ADR-0010](../../decisions/0010-postgres-only.md)); a new one needs an ADR of its own. |
| Migrating existing Confluence spaces into Kintsugi | Useful later, but it is an importer, not wiki parity; ranked Could in the authoring research. |

## Principles

Every proposal in this pack respects these, or names the ADR that would have to change:

1. **Git is the source of truth.** A page's text, its attachments and its history are files and commits in the project's document repository; Postgres keeps only indexes and the state Git cannot hold (comments, watches, notifications, reads). [ADR-0007](../../decisions/0007-git-as-source-of-truth.md)
2. **Markdown only.** A page is a Markdown document with front matter; tables and cards are Markdown; diagrams are Mermaid. [ADR-0042](../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)
3. **The layout is the tree.** The page tree follows the numbered layout and paths built in `packages/domain/src/document-layout.ts`; the wiki adds no second hierarchy that can disagree with the folders. [ADR-0051](../../decisions/0051-document-repo-layout-legacy-and-modern.md)
4. **One writer.** Every change to the repository goes through the worker's writer and its rules (validation, fast-forward pushes, `kintsugi/*` branches and pull requests for review). [ADR-0019](../../decisions/0019-workspace-repo-write-path.md)
5. **Postgres is the only datastore, in a self-hosted Compose package.** No new service without an ADR. [ADR-0010](../../decisions/0010-postgres-only.md), [ADR-0006](../../decisions/0006-self-hosted-package.md)
6. **Access through the permission catalog.** Permissions are codes in `core.permission`, granted through access roles; the wiki adds codes by migration and never hard-codes lists. [ADR-0008](../../decisions/0008-authentication.md), [ADR-0024](../../decisions/0024-access-roles-vs-project-roles.md)
7. **A small engine.** No language parsers, no code graph, no model calls to build indexes. [ADR-0014](../../decisions/0014-no-code-graph-no-agent-config.md), [ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)
8. **The Brain sees what people see.** Pages are indexed by the Brain from the reviewed branch, cited as `path:lines@commit`, and what a reader may not see stays out of the tree, search and member tools. [ADR-0091](../../decisions/0091-brain-vectorless-tree-index.md)

## How the research is written

| Item | Convention |
|---|---|
| Feature ids | `AUT-nn` (authoring), `COL-nn` (collaboration and access), `DIS-nn` (discovery and lifecycle) |
| Area files | `feature-matrix.md`, the user stories, `gap-analysis.md`, `open-questions.md` in each area folder |
| Matrix row | id, the Confluence behaviour in one sentence, a public documentation URL, Kintsugi today (a code path or doc page), status `have` / `partial` / `gap`, the proposed MoSCoW |
| Stories | one persona from the table above, "As a … I want … so that …", 2-4 Given/When/Then criteria a tester can check |
| Sources | public documentation only, cited by URL; Git-backed wikis (Wiki.js, BookStack, Outline, GitBook, Docusaurus) as comparisons |

### MoSCoW

| Priority | Means for Kintsugi |
|---|---|
| **M**ust | without it the portal is not a usable project wiki: a member could not find, read, write, move or discuss a page, or an admin could not control who sees it |
| **S**hould | expected by people coming from Confluence and cheap on top of the Musts; in the second phase |
| **C**ould | useful, but costly or needed by few; after the Shoulds, if evidence asks for it |
| **W**on't (this time) | out of scope above, or conflicts with a principle without enough value to change it |

The analysts propose a priority per row; the product owner sets the final one in the matrix below.

## Feature matrix

Every feature of the three area matrices, once, with the analyst's proposal and the final priority. Where the final priority differs, the reason is in the cell. The behaviour, Kintsugi's state today and the persona each feature serves are in the area matrix it links to; rows without a Confluence source are Kintsugi's own additions.

The final priorities follow three choices the architects made on the board and the ADR proposals record:

- **No real-time co-editing.** Edits from the portal are drafts in Postgres, published as commits through the writer, with a three-way merge when the base moved; co-editing (a CRDT service) is Won't for these phases.
- **No view restriction on pages in Git.** Everyone with Project Access, every member's local clone and every mirror holds the text, so a per-page read restriction would not be a control. Project Access is the read boundary; edit and publish restrictions per space or path are real controls because publishing goes through the writer.
- **Review is the pull request.** A publish opens a pull request by default; a direct publish needs a path the manifest allows and a permission.

| Priority | Features |
|---|---|
| Must | 48 |
| Should | 52 |
| Could | 35 |
| Won't | 14 |

### Authoring

From the [authoring matrix](10-authoring/feature-matrix.md).

| ID | Feature | Analyst | Final | Source |
|---|---|---|---|---|
| AUT-01 | Create a space | M | **S** (the numbered roots are the project's spaces until team spaces come) | [Atlassian, Create a space](https://support.atlassian.com/confluence-cloud/docs/create-a-space/) |
| AUT-02 | Space key and address | S | **S** | [Atlassian, Create a space](https://support.atlassian.com/confluence-cloud/docs/create-a-space/) |
| AUT-03 | Space home page | S | **S** | [Atlassian Community, a space home page and the page tree](https://community.atlassian.com/t5/Confluence-questions/How-to-add-a-page-tree-in-the-sidebar-in-the-new-cloud-design/qaq-p/626149) |
| AUT-04 | Page tree sidebar | M | **M** | [Atlassian Community, a space home page and the page tree](https://community.atlassian.com/t5/Confluence-questions/How-to-add-a-page-tree-in-the-sidebar-in-the-new-cloud-design/qaq-p/626149) |
| AUT-05 | Reorder pages | S | **S** | [Atlassian, Organize your space](https://support.atlassian.com/confluence-cloud/docs/organize-your-space/) |
| AUT-06 | Space directory | S | **S** | [Atlassian, Create a space](https://support.atlassian.com/confluence-cloud/docs/create-a-space/) |
| AUT-07 | Archive a space | C | **C** | [Atlassian, Archive a space](https://support.atlassian.com/confluence-cloud/docs/archive-a-space/) |
| AUT-08 | Space settings | C | **C** | [Atlassian, Organize your space](https://support.atlassian.com/confluence-cloud/docs/organize-your-space/) |
| AUT-09 | Personal space | W | **W** | [Atlassian, Create a space](https://support.atlassian.com/confluence-cloud/docs/create-a-space/) |
| AUT-10 | Hide a page from the tree | C | **C** | [Atlassian Community, move, delete and copy pages (a product manager's post)](https://community.atlassian.com/t5/Confluence-articles/Easy-ways-to-move-delete-and-pages-in-Confluence/ba-p/1630140) |
| AUT-11 | Create a page | M | **M** | [Atlassian Community, a space home page and the page tree](https://community.atlassian.com/t5/Confluence-questions/How-to-add-a-page-tree-in-the-sidebar-in-the-new-cloud-design/qaq-p/626149) |
| AUT-12 | Edit a published page | M | **M** | [Atlassian, Collaborative editing (developer documentation)](https://developer.atlassian.com/cloud/confluence/collaborative-editing/) |
| AUT-13 | Rename a page | M | **M** | [Atlassian Community, move, delete and copy pages (a product manager's post)](https://community.atlassian.com/t5/Confluence-articles/Easy-ways-to-move-delete-and-pages-in-Confluence/ba-p/1630140) |
| AUT-14 | Move a page | M | **M** | [Atlassian, Organize your space](https://support.atlassian.com/confluence-cloud/docs/organize-your-space/) |
| AUT-15 | Copy a page | S | **S** | [Atlassian, Copy a page (Data Center 8.0 documentation)](https://confluence.atlassian.com/display/CONF80/Copy+a+Page) |
| AUT-16 | Delete a page | M | **M** | [Atlassian, Delete, restore, or purge a content item](https://support.atlassian.com/confluence-cloud/docs/delete-restore-or-purge-a-page/) |
| AUT-17 | Restore or purge | S | **S** | [Atlassian, Delete, restore, or purge a content item](https://support.atlassian.com/confluence-cloud/docs/delete-restore-or-purge-a-page/) |
| AUT-18 | Archive a page | C | **C** | [Atlassian, Archive content items](https://support.atlassian.com/confluence-cloud/docs/archive-pages/) |
| AUT-19 | Page properties | S | **S** | [Atlassian, Collaborative editing (developer documentation)](https://developer.atlassian.com/cloud/confluence/collaborative-editing/) |
| AUT-20 | Markdown source with preview | M | **M** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-21 | Rich-text editing | S | **S** | [Atlassian, Collaborative editing (developer documentation)](https://developer.atlassian.com/cloud/confluence/collaborative-editing/) |
| AUT-22 | Slash command and insert menu | C | **C** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-23 | Markdown shortcuts | C | **C** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-24 | Tables | S | **S** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-25 | Code blocks | M | **M** | [Atlassian, Working with macros (the Code Block macro; older documentation)](https://confluence.atlassian.com/spaces/CONF20/pages/59805856/Working+with+Macros) |
| AUT-26 | Diagrams | M | **M** | [draw.io, Insert a diagram in Confluence Cloud (Mermaid import)](https://www.drawio.com/docs/tutorials/install-insert-diagram-confluence-cloud/) |
| AUT-27 | Other diagram tools | W | **W** | [draw.io, Insert a diagram in Confluence Cloud (Mermaid import)](https://www.drawio.com/docs/tutorials/install-insert-diagram-confluence-cloud/) |
| AUT-28 | Headings and anchors | M | **M** | [Atlassian, Insert links and anchors](https://support.atlassian.com/confluence-cloud/docs/insert-links-and-anchors/) |
| AUT-29 | Layouts and columns | W | **W** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-30 | Inline elements | C | **C** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-31 | Autosave a draft | M | **M** | [Atlassian knowledge base, How do drafts work on Confluence](https://confluence.atlassian.com/confkb/how-do-drafts-work-on-confluence-938043306.html) |
| AUT-32 | Drafts list | S | **S** | [Atlassian knowledge base, How do drafts work on Confluence](https://confluence.atlassian.com/confkb/how-do-drafts-work-on-confluence-938043306.html) |
| AUT-33 | Explicit publish | M | **M** | [Atlassian, Collaborative editing (shared draft and publish; Server and Data Center documentation)](https://confluence.atlassian.com/display/DOC/Collaborative+editing) |
| AUT-34 | Conflict detection | M | **M** | [Atlassian, Collaborative editing (shared draft and publish; Server and Data Center documentation)](https://confluence.atlassian.com/display/DOC/Collaborative+editing) |
| AUT-35 | Real-time collaborative editing | W | **W** | [Atlassian, Collaborative editing (shared draft and publish; Server and Data Center documentation)](https://confluence.atlassian.com/display/DOC/Collaborative+editing) |
| AUT-36 | Publish message | S | **S** | [Atlassian, Collaborative editing (shared draft and publish; Server and Data Center documentation)](https://confluence.atlassian.com/display/DOC/Collaborative+editing) |
| AUT-37 | Info, tip, note and warning panels | M | **M** | [Atlassian, Insert the info, tip, note, and warning macros](https://support.atlassian.com/confluence-cloud/docs/insert-the-info-tip-note-and-warning-macros/) |
| AUT-38 | Table of contents | S | **S** | [Atlassian, Insert the table of contents macro](https://support.atlassian.com/confluence-cloud/docs/insert-the-table-of-contents-macro/) |
| AUT-39 | Expand section | C | **C** | [Atlassian, Keyboard shortcuts, markdown and autocomplete](https://confluence.atlassian.com/confcloud/keyboard-shortcuts-724764740.html) |
| AUT-40 | Excerpt and include page | C | **C** | [Atlassian, Add excerpts with the excerpt macro](https://support.atlassian.com/confluence-cloud/docs/insert-the-excerpt-include-macro/) |
| AUT-41 | Listing macros | S | **S** | [Atlassian, Use macros to show Confluence content on pages and live docs](https://support.atlassian.com/confluence-cloud/docs/use-macros-to-show-confluence-content-on-pages/) |
| AUT-42 | Data macros | C | **C** | [Atlassian, Use macros to show Confluence content on pages and live docs](https://support.atlassian.com/confluence-cloud/docs/use-macros-to-show-confluence-content-on-pages/) |
| AUT-43 | Third-party macros | W | **W** | [draw.io, Insert a diagram in Confluence Cloud (Mermaid import)](https://www.drawio.com/docs/tutorials/install-insert-diagram-confluence-cloud/) |
| AUT-44 | Attach a file to a page | M | **M** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-45 | Insert an image | M | **M** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-46 | Manage the attachments of a page | S | **S** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-47 | Preview of office files and PDFs | C | **C** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-48 | Size and type limits | M | **M** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-49 | Link to a page by title | M | **S** (relative links work without it; title autocomplete is comfort) | [Atlassian, Insert links and anchors](https://support.atlassian.com/confluence-cloud/docs/insert-links-and-anchors/) |
| AUT-50 | Link to a heading | M | **M** | [Atlassian, Insert links and anchors](https://support.atlassian.com/confluence-cloud/docs/insert-links-and-anchors/) |
| AUT-51 | Link to an attachment | S | **S** | [Atlassian, Upload a file](https://support.atlassian.com/confluence-cloud/docs/upload-a-file) |
| AUT-52 | Backlinks ("what links here") | S | **S** | [Atlassian, Insert links and anchors](https://support.atlassian.com/confluence-cloud/docs/insert-links-and-anchors/) |
| AUT-53 | Broken-link check | M | **M** | [Atlassian Community, move, delete and copy pages (a product manager's post)](https://community.atlassian.com/t5/Confluence-articles/Easy-ways-to-move-delete-and-pages-in-Confluence/ba-p/1630140) |
| AUT-54 | Link integrity on move, rename and delete | M | **M** | [Atlassian, Organize your space](https://support.atlassian.com/confluence-cloud/docs/organize-your-space/) |
| AUT-55 | Export a page to PDF | S | **S** | [Atlassian, Export content to Word, PDF, HTML and XML (Data Center 7.2 documentation)](https://confluence.atlassian.com/display/CONF72/Export+Content+to+Word%2C+PDF%2C+HTML+and+XML) |
| AUT-56 | Export a page to Word | C | **C** | [Atlassian, Export content to Word, PDF, HTML and XML (Data Center 7.2 documentation)](https://confluence.atlassian.com/display/CONF72/Export+Content+to+Word%2C+PDF%2C+HTML+and+XML) |
| AUT-57 | Export a space | C | **C** | [Atlassian, Export content to Word, PDF, HTML and XML (Data Center 7.2 documentation)](https://confluence.atlassian.com/display/CONF72/Export+Content+to+Word%2C+PDF%2C+HTML+and+XML) |
| AUT-58 | Export as Markdown | M | **M** | [Atlassian, Export content to Word, PDF, HTML and XML (Data Center 7.2 documentation)](https://confluence.atlassian.com/display/CONF72/Export+Content+to+Word%2C+PDF%2C+HTML+and+XML) |
| AUT-59 | Import a Word document | S | **C** (Word import needs a converter in the worker image, a new dependency) | [Atlassian, Import external documents](https://support.atlassian.com/confluence-cloud/docs/import-content-into-confluence-cloud/) |
| AUT-60 | Import Markdown and HTML | S | **S** | [Atlassian, Import external documents](https://support.atlassian.com/confluence-cloud/docs/import-content-into-confluence-cloud/) |
| AUT-61 | Bulk import and space import | C | **C** | [Atlassian, Import external documents](https://support.atlassian.com/confluence-cloud/docs/import-content-into-confluence-cloud/) |

### Collaboration and access

From the [collaboration and access matrix](20-collaboration/feature-matrix.md).

| ID | Feature | Analyst | Final | Source |
|---|---|---|---|---|
| COL-01 | Page comments with replies | M | **M** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-02 | Inline comments anchored to text | M | **M** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-03 | Resolve and reopen inline comments | S | **S** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-04 | Edit and delete comments | S | **S** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-05 | Comments on a draft stay hidden until publish | C | **C** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-06 | Reactions and likes | C | **C** | [Comment on pages, live docs, whiteboards, blog posts, and slides](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/) |
| COL-07 | Comments by agents and about agents | S | **S** | none: no Confluence equivalent |
| COL-08 | @mention a person | M | **M** | [Add action items and @mentions](https://support.atlassian.com/confluence-cloud/docs/add-action-items-and-mentions/) |
| COL-09 | Notify on the first mention only | S | **S** | [Add action items and @mentions](https://support.atlassian.com/confluence-cloud/docs/add-action-items-and-mentions/) |
| COL-10 | A mention never reveals a page to someone without access | M | **M** | [Manage permissions at the content level (users without access are not notified)](https://support.atlassian.com/confluence-cloud/docs/manage-permissions-on-the-page-level/) |
| COL-11 | Mention a team | W | **W** | [Mention a person, team, or AI agent](https://support.atlassian.com/confluence-cloud/docs/mention-a-person-team-or-ai-agent/) |
| COL-12 | Action items (tasks) with an assignee | C | **C** | [Add action items and @mentions](https://support.atlassian.com/confluence-cloud/docs/add-action-items-and-mentions/) |
| COL-13 | Watch a page or a space | M | **M** | [Watch pages, live docs, spaces, whiteboards, blogs, and slides](https://support.atlassian.com/confluence-cloud/docs/watch-pages-spaces-and-blogs/) |
| COL-14 | Autowatch | S | **S** | [Watch pages, live docs, spaces, whiteboards, blogs, and slides](https://support.atlassian.com/confluence-cloud/docs/watch-pages-spaces-and-blogs/) |
| COL-15 | In-app notification inbox | M | **M** | [View your notifications](https://support.atlassian.com/confluence-cloud/docs/view-your-notifications/) |
| COL-16 | Email notifications: real time and daily digest | C | **C** | [Subscribe to email updates](https://support.atlassian.com/confluence-cloud/docs/subscribe-to-email-notifications/) |
| COL-17 | Notification preferences and watch list | S | **S** | [Subscribe to email updates](https://support.atlassian.com/confluence-cloud/docs/subscribe-to-email-notifications/) |
| COL-18 | Notifications respect view permission | M | **M** | [Watch pages, live docs, spaces, whiteboards, blogs, and slides](https://support.atlassian.com/confluence-cloud/docs/watch-pages-spaces-and-blogs/) |
| COL-19 | Share a page with a person | S | **S** | [Share Confluence content](https://support.atlassian.com/confluence-cloud/docs/share-confluence-content/) |
| COL-20 | Access requests | C | **C** | [Change who can find content and what they can do with it](https://support.atlassian.com/confluence-cloud/docs/add-or-remove-page-restrictions/) |
| COL-21 | Public links and anonymous access | W | **W** | [Share content externally with public links](https://support.atlassian.com/confluence-cloud/docs/share-content-externally-with-public-links/) |
| COL-22 | Three-level model | M | **M** | [Confluence permissions structure](https://support.atlassian.com/confluence-cloud/docs/what-are-confluence-cloud-permissions-and-restrictions/) |
| COL-23 | Space permissions and roles | M | **M** | [What are Confluence's roles? (space permissions and roles)](https://support.atlassian.com/confluence-cloud/docs/what-are-space-permissions/) |
| COL-24 | Per-operation space permissions | S | **S** | [What are Confluence's roles? (space permissions and roles)](https://support.atlassian.com/confluence-cloud/docs/what-are-space-permissions/) |
| COL-25 | Page edit restriction | M | **M** | [Change who can find content and what they can do with it](https://support.atlassian.com/confluence-cloud/docs/add-or-remove-page-restrictions/) |
| COL-26 | Page view restriction and inheritance | W | **W** | [Change who can find content and what they can do with it](https://support.atlassian.com/confluence-cloud/docs/add-or-remove-page-restrictions/) |
| COL-27 | Restricted pages as encrypted records | S | **C** (a new kind of content outside Git; needs its own ADR first) | [Confluence permissions structure](https://support.atlassian.com/confluence-cloud/docs/what-are-confluence-cloud-permissions-and-restrictions/) |
| COL-28 | Restrictions only narrow | M | **M** | [Manage permissions at the content level (users without access are not notified)](https://support.atlassian.com/confluence-cloud/docs/manage-permissions-on-the-page-level/) |
| COL-29 | List restricted content in a space | S | **S** | [Confluence permissions structure](https://support.atlassian.com/confluence-cloud/docs/what-are-confluence-cloud-permissions-and-restrictions/) |
| COL-30 | Admin override with audit | C | **C** | [View the audit log (also lists the admin key)](https://support.atlassian.com/confluence-cloud/docs/view-the-audit-log/) |
| COL-31 | Group grants | S | **S** | [Confluence permissions structure](https://support.atlassian.com/confluence-cloud/docs/what-are-confluence-cloud-permissions-and-restrictions/) |
| COL-32 | Real-time co-editing | W | **W** | [Create and collaborate in real time with live docs](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/) |
| COL-33 | Presence on a page | S | **S** | [Create and collaborate in real time with live docs](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/) |
| COL-34 | Conflict handling on concurrent edits | M | **M** | [Create and collaborate in real time with live docs](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/) |
| COL-35 | Page approvals | S | **S** | [Request and manage approvals in Confluence](https://support.atlassian.com/confluence-cloud/docs/request-and-manage-approvals-in-confluence/) |
| COL-36 | Version history shows who changed what | S | **S** | [Create and collaborate in real time with live docs](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/) |
| COL-37 | Audit of permission and restriction changes | M | **M** | [View the audit log (also lists the admin key)](https://support.atlassian.com/confluence-cloud/docs/view-the-audit-log/) |
| COL-38 | Audit of reads of sensitive pages | S | **C** (only meaningful once COL-27 exists) | [View the audit log (also lists the admin key)](https://support.atlassian.com/confluence-cloud/docs/view-the-audit-log/) |
| COL-39 | Page analytics | C | **C** | [View insights on pages](https://support.atlassian.com/confluence-cloud/docs/view-insights-on-pages/) |

### Discovery and lifecycle

From the [discovery and lifecycle matrix](30-discovery/feature-matrix.md).

| ID | Feature | Analyst | Final | Source |
|---|---|---|---|---|
| DIS-01 | A search box on every screen finds pages across all spaces the person can see | M | **M** | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-02 | Matches the words in the title and in the body, in any order, with quoted phrases | M | **M** | [Confluence search syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/) |
| DIS-03 | Each hit shows an excerpt with the matching words highlighted and where the page lives | M | **M** | [Ranking of search results](https://support.atlassian.com/confluence/kb/how-to-understand-the-ranking-of-confluences-search-results/) |
| DIS-04 | Results are ranked: a title match counts more than a body match and newer content is slightly more relevant | S | **S** | [Ranking of search results (Data Center)](https://confluence.atlassian.com/display/DOC/Ranking+of+Search+Results) |
| DIS-05 | Filter by space | M | **M** | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-06 | Filter by label | M | **M** | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-07 | Filter by contributor or creator | S | **S** | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-08 | Filter by content type (page, blog post, attachment, comment, space) | S | **S** | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-09 | Filter by date last modified or created | S | **S** | [CQL fields](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-10 | An advanced query language (CQL) combines fields, operators and ordering | C | **C** | [Advanced searching using CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) |
| DIS-11 | Search inside attachments (PDF, Word, spreadsheets) | W | **W** | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-12 | Search comments | S | **S** | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-13 | Tolerance for word forms and typos | C | **C** | [Ranking of search results](https://support.atlassian.com/confluence/kb/how-to-understand-the-ranking-of-confluences-search-results/) |
| DIS-14 | Results respect who may see what | M | **M** | [Search for content](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-15 | Recent and saved searches | W | **W** | [Search the site](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-16 | Operators `AND` and `OR`, grouping with brackets, wildcards `?` and `*` (not at the start of a word) | C | **C** | [Confluence search syntax](https://support.atlassian.com/confluence-cloud/docs/confluence-search-syntax/) |
| DIS-17 | *Search titles only*, and quick search that lists the most recently updated items first | S | **S** | [Search for content](https://support.atlassian.com/confluence-cloud/docs/search-for-pages-and-posts/) |
| DIS-20 | Add and remove labels on a page | M | **M** | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) |
| DIS-21 | A label page lists every page with that label, across spaces | M | **M** | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) |
| DIS-22 | Label naming rules (lower case, no spaces, a bound on length and count) | M | **M** | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) |
| DIS-23 | A *Content by label* list embedded in a page: AND/OR of labels, space, sorting | S | **S** | [Display pages with label macros](https://confluence.atlassian.com/spaces/DOC/pages/145102/Display+Pages+with+Label+Macros) |
| DIS-24 | *Popular labels*: a label cloud or list of the most used labels of a space or site | C | **C** | [Popular labels macro](https://support.atlassian.com/confluence-cloud/docs/insert-the-popular-labels-macro/) |
| DIS-25 | Labels on attachments | W | **W** | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) |
| DIS-26 | Personal (`my:`) labels | W | **W** | [Use labels to organize content](https://support.atlassian.com/confluence-cloud/docs/use-labels-to-organize-your-content/) |
| DIS-30 | Create a page from a template; the template applies only at creation and the page is not linked to it afterwards | M | **M** | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) |
| DIS-31 | Space and site templates, written by space or site admins | S | **S** | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) |
| DIS-32 | Template variables: fields the author fills in, and instructional text that disappears | S | **S** | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) |
| DIS-33 | Blueprints: ready-made templates with extra behaviour (meeting notes, decision log, how-to, product requirements) and an index page of what  | S | **S** | [Blueprints](https://support.atlassian.com/confluence-cloud/docs/pre-format-your-content-with-templates/) |
| DIS-34 | Templates appear in the Create dialog; admins promote or hide them per space | C | **C** | [Page templates](https://confluence.atlassian.com/conf717/page-templates-1115675528.html) |
| DIS-35 | Create a whole page tree from one template | C | **C** | [Space tree creator (Marketplace, *secondary*)](https://marketplace.atlassian.com/apps/1214324/space-tree-creator-blueprint-template) |
| DIS-40 | A page history lists versions with number, author, date and change comment | M | **M** | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-41 | View an older version as it was | M | **M** | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-42 | Compare two versions: added content green, removed red, formatting changes blue | M | **M** | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-43 | Restore a version: it becomes a new current version and the history is kept | M | **M** | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-44 | Restoring warns when an unpublished draft exists and discards it | S | **S** | [Page history and comparison](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-45 | A page keeps its history when it is moved or renamed | S | **S** | [Move and reorder pages](https://support.atlassian.com/confluence-cloud/docs/move-copy-and-hide-pages/) |
| DIS-46 | A deleted page goes to the space trash and can be restored, to the root of the space and without its inherited permissions, until it is purg | S | **S** | [Delete, restore, or purge a content item](https://support.atlassian.com/confluence-cloud/docs/delete-restore-or-purge-a-page/) |
| DIS-47 | A recent-changes feed per space and site ("Recent updates") | S | **S** | [Confluence home page](https://support.atlassian.com/confluence-cloud/docs/experience-the-new-home-page/) |
| DIS-48 | Delete one version permanently, and retention rules that remove old versions | W | **W** | [Page history](https://confluence.atlassian.com/display/DOC/Page+History+and+Page+Comparison+Views) |
| DIS-50 | Archive a page: it leaves the tree and search by default and can be restored; the archive is available on the Standard plan | S | **S** | [Archive content items](https://support.atlassian.com/confluence-cloud/docs/archive-pages/) |
| DIS-51 | A list of archived pages, and restore from it to a parent the person chooses | S | **S** | [Restore archived items](https://support.atlassian.com/confluence-cloud/docs/restore-archived-pages-to-the-page-tree/) |
| DIS-52 | Bulk archive and restore, up to 500 pages, a Premium feature | C | **C** | [Restore archived items](https://support.atlassian.com/confluence-cloud/docs/restore-archived-pages-to-the-page-tree/) |
| DIS-60 | A page shows how many people viewed it; details open from the byline | C | **C** | [Content insights and analytics](https://support.atlassian.com/confluence-cloud/docs/view-insights-on-pages/) |
| DIS-61 | Views and unique viewers over time, a table of viewers with last version viewed, an engagement mark after 20 seconds, and a privacy mode tha | C | **C** | [Content insights and analytics](https://support.atlassian.com/confluence-cloud/docs/view-insights-on-pages/) |
| DIS-62 | Space and site analytics: most viewed pages, content that nobody reads | C | **C** | [Content insights and analytics](https://support.atlassian.com/confluence-cloud/docs/view-insights-on-pages/) |
| DIS-63 | Agent reads count as readers: which pages the members' agents cite | S | **S** | none: no Confluence equivalent |
| DIS-70 | Star a page; starred pages are listed under Recent | S | **S** | [Star pages](https://support.atlassian.com/confluence-cloud/docs/save-a-page-for-later/) |
| DIS-71 | Recently viewed and recently worked on pages | S | **S** | [Confluence home page](https://support.atlassian.com/confluence-cloud/docs/experience-the-new-home-page/) |
| DIS-72 | A personal home with recent updates, starred and popular pages | C | **C** | [Confluence home page](https://support.atlassian.com/confluence-cloud/docs/experience-the-new-home-page/) |

