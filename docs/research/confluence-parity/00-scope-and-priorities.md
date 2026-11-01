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
| Authoring | spaces and the page tree; create, edit, move, copy, delete; the editor (tables, code, Mermaid diagrams); macros and embeds; attachments and images; links and backlinks; drafts and autosave; export and import | `10-authoring/` |
| Collaboration and access | page and inline comments; mentions; watching and notifications; co-editing versus Git review; approvals; sharing; space and page permissions and restrictions; audit | `20-collaboration/` |
| Discovery and lifecycle | search and filters; labels; templates and blueprints; version history, compare and restore; archive and trash; analytics; recently viewed and favourites | `30-discovery/` |
| Architecture | the data model on Git and Postgres, the Brain integration, the target building blocks and the fit with Kintsugi's constraints | `40-architecture/` |

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

The consolidated matrix, with the final priority of every feature, is filled from the three area matrices as they are accepted.
