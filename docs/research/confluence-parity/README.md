# Confluence parity: a project wiki on the document repository

> Research pack. How Kintsugi would offer the feature set of a Confluence-like wiki (spaces and the page tree, editing, macros, attachments, comments, mentions, notifications, permissions, search, labels, templates and version history) on top of what it already has, and how the wiki fits with the Brain ([ADR-0091](../../decisions/0091-brain-vectorless-tree-index.md)). The four decisions below are accepted.

## The question

Teams keep their project knowledge in a wiki because it lets them write, organise, discuss, find and trace pages in a browser. Kintsugi already keeps everything about a project except its code in one Git document repository of Markdown documents, shows it in the portal and indexes it as the Brain for people and members' agents. Can Kintsugi be that wiki without a second content store, and what would it take?

## The answer in five lines

1. **Yes, as a view over the document repository.** A page is a Markdown file with front matter (a stable `id`, title, labels, status, order); a space is a folder with a home page; the page tree is the folder tree; history is Git. Nothing is copied into another store.
2. **Edits are drafts in Postgres and publishes are commits.** The portal's Markdown editor autosaves to a draft; a publish is one write through the existing writer, reviewed by pull request unless the manifest allows a direct publish on that path; a moved base is merged three ways, never overwritten.
3. **Conversation lives beside Git, not in it.** Comments, mentions, watches, notifications, favourites and drafts are Postgres rows keyed by the page id, so they survive moves and renames.
4. **The Brain becomes the wiki's index.** It reads labels, status and order from front matter, keeps backlinks, builds incrementally on a publish and adds a full-text index for people's search, while agents still navigate the tree and cite `path:lines@commit`.
5. **Two deliberate limits.** No real-time co-editing (a live service and a second source of truth) and no per-page view restriction on content in Git (every clone holds the text); Project Access is the read boundary, and edit and publish rules per space are the controls.

## Reading order

| # | Part | What it answers |
|---|---|---|
| 1 | [Scope and priorities](00-scope-and-priorities.md) | Who the wiki serves, what is out of scope, the principles, and the [feature matrix](00-scope-and-priorities.md#feature-matrix) with the final MoSCoW of 149 features |
| 2 | Authoring: [overview](10-authoring/README.md), [feature matrix](10-authoring/feature-matrix.md), [user stories](10-authoring/user-stories.md), [gap analysis](10-authoring/gap-analysis.md), [open questions](10-authoring/open-questions.md), [Git-backed wikis compared](10-authoring/git-wiki-comparison.md) | Spaces, the page tree, the editor, macros, attachments, links, drafts, export and import |
| 3 | Collaboration and access: [overview](20-collaboration/README.md), [feature matrix](20-collaboration/feature-matrix.md), [user stories](20-collaboration/user-stories.md), [gap analysis](20-collaboration/gap-analysis.md), [open questions](20-collaboration/open-questions.md), [Git-backed wikis compared](20-collaboration/git-wiki-comparison.md) | Comments, mentions, watching, notifications, co-editing, approvals, permissions and audit |
| 4 | Discovery and lifecycle: [overview](30-discovery/README.md), [feature matrix](30-discovery/feature-matrix.md), [user stories](30-discovery/user-stories.md), [gap analysis](30-discovery/gap-analysis.md), [open questions](30-discovery/open-questions.md) | Search, labels, templates, version history, archive, analytics and personal lists |
| 5 | Architecture: [constraints and fit](40-architecture/constraints-and-fit.md), [target architecture](40-architecture/target-architecture.md), [data model](40-architecture/data-model.md), [Brain integration](40-architecture/brain-integration.md) | Which features fit Kintsugi's constraints, the building blocks, where every object lives and how the Brain serves it |
| 6 | [Roadmap](90-roadmap.md) | The phases, what each needs and how to tell it is done, and the top risks |

## Decisions

The research led to four decisions, accepted by the owner on 2 November 2026.

| ADR | Decides | Status |
|---|---|---|
| [ADR-0096](../../decisions/0096-wiki-pages-in-the-document-repo.md) | Wiki spaces and pages are Markdown in the document repository with a stable page id in front matter, team spaces under `20-spaces/`, attachments beside the page (amending Markdown only for attachments), and collaboration state in Postgres | Accepted |
| [ADR-0097](../../decisions/0097-brain-indexes-wiki-pages.md) | The Brain indexes and serves wiki pages: front matter attributes, backlinks, incremental builds on publish and a full-text index beside exact search (amending ADR-0091) | Accepted |
| [ADR-0098](../../decisions/0098-wiki-page-editing-and-publishing.md) | Pages are edited as Markdown in the portal, kept as drafts in Postgres and published through the document writer, by pull request unless a path allows a direct publish, with a three-way merge on a moved base | Accepted |
| [ADR-0099](../../decisions/0099-wiki-collaboration-and-access.md) | Comments, watches and notifications live in Postgres; access is edit rules on paths, with Project Access as the view boundary | Accepted |

## Open questions for the owner

1. **Is Project Access enough as the read boundary?** The design offers no per-page view restriction on content in Git. Projects that need pages only some members may read would need restricted pages as encrypted records outside Git, which is a new kind of content and its own ADR (ranked Could).
2. **Is a Markdown source editor acceptable for the first release?** Rich-text editing waits until it round-trips every document byte for byte. People used to Confluence may expect it from the start; the roadmap places it in Phase 4.
3. **How much review should a wiki edit get?** A pull request per publish is the default and keeps Git's review. A project that wants a fast wiki must list low-risk paths in `directPublishPaths`; who sets that list, and is the default right?
4. **Fix the portal's document routes first?** They check a session but not Project Access today. That is a gap independent of the wiki; the roadmap puts the fix in Phase 0.
5. **Email notifications.** In-app notifications are in scope; email or webhooks are an outbound dependency the installation does not have yet. Is it worth its own ADR now, or after Phase 3?

## How this pack was made

Analysts read public documentation only (Confluence Cloud and Data Center, and Git-backed wikis for comparison), each claim cited by URL, and checked every statement about Kintsugi against the code and the documentation. The architects settled the constraint questions on the way and wrote the four proposals. The product owner set the final priorities and accepted each part against its acceptance criteria.
