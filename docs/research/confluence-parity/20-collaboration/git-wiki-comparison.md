# Collaboration and access in Git-backed and open-source wikis

> Research pack, area 20-collaboration (ticket BC-005). How five documentation tools handle comments, notifications, permissions, co-editing, Git storage and audit, read from their public documentation on 1 Nov 2026, and what each finding means for a decision in [open questions](open-questions.md). It compares; it changes no decision. The Confluence side is in the [feature matrix](feature-matrix.md).

## Reading limits

The pages were read through a summarising fetch. **Wiki.js** documentation pages returned only their titles, so its row rests on search summaries of the official pages and on the documented facts they quote; **Docusaurus** and **BookStack** were read only at their index and a few pages. A cell that says *not in pages read* means the page read did not cover it, not that the tool lacks the feature. Every URL is public and needs no sign-in.

## Comparison

| Topic | Wiki.js | BookStack | Outline | GitBook | Docusaurus |
|---|---|---|---|---|---|
| Comments | Built in from version 2.4; external comment providers keep data outside the Wiki.js database (W2). Internal comments use the groups and page rules (moderation permission `manage:comments`, read `read:comments`, from a summary of the docs). | Not in pages read. | On a text selection or the whole document; the API creates, edits, deletes, resolves and reacts (O5). | On a page or a block; replies make threads; reactions; resolve hides a comment into a "Resolved" tab (G1). | None in core; "delegated to individual plugins" (D1). |
| Mentions and notifications | Not in pages read. | Activity and watch notification emails; a failed send is only logged (B1). No mention mechanism in pages read. | In-app and email alerts for mentions, comments and updates; mentioning a group notifies its members, switchable per group (O5). | `@` tags teammates; guests cannot see or mention other users (G1). Notification behaviour not stated. | None documented. |
| Permissions | Groups hold permissions and page rules; users in several groups; global permissions take priority over page rules (W1). | Roles per user that stack; overrides at shelf, book, chapter or page; book and chapter overrides cascade to children, shelf overrides do not; "Everyone Else" option; on a conflict at the same level the grant wins (B2). | Collection is the permission boundary: view, view and edit, admin; individuals and groups; the higher permission wins; groups can also be given a single document (O1, O2, O3). | Roles Guest, Reader, Commenter, Editor, Reviewer, Creator, Admin; content-level permissions for Creators (G2). | None. |
| Public or anonymous access | Not in pages read. | Not in pages read. | Public sharing can be disabled per collection (O1). | Not stated. | A static site is public by deployment. |
| Co-editing vs review | Not in pages read. | Not in pages read; no Git review workflow found. | Not in pages read. | **Change requests**: a copy of the content, reviewers approve, comment or request edits; merge applies to live docs; merge rules require reviews, all approved, an up-to-date change request, bypass actors (G3, G4). Real-time editing not stated. | None. |
| Storage and Git | **Git storage module**: needs a repository dedicated to Wiki.js (no subfolder), syncs on an interval (5 minutes by default); content created before the module is enabled needs a manual import or Force Sync (W3). | A database; Markdown and HTML in the `pages` table, files on disk; Git not mentioned (B3). | Not Git in pages read; per-document revision history (O4). | **Git Sync**, bi-directional with GitHub or GitLab; only administrators and creators enable it; which content syncs (comments, change requests, permissions) is not stated (G5). | Markdown files in a repository; the framework does not require Git. |
| Audit | Not in pages read. | Not in pages read; outgoing webhooks exist (B1). | Document revision history; admins check activity per user; an audit trail location is mentioned without detail (O4, O6). | Not stated. | None. |

## What it means for Kintsugi's decisions

| Finding | Decision it touches | Reading |
|---|---|---|
| None of the tools reads or writes comments as repository files in the pages read; GitBook's sync page does not say that comments travel with it (G5). | Q1 comments in Postgres | **Confirms.** No evidence of a tool that keeps conversation in Git. Not conclusive for GitBook. |
| Permissions in every application tool are enforced by the application over its own store, at a container level (collection, book, shelf, space) with groups (B2, O1, O2, W1, G2). | Q3 edit rules enforced by the API; Q4 grants to access roles | **Confirms** the shape: a container-level grant plus groups. Kintsugi's "groups" are access roles, as decided. |
| Wiki.js and GitBook can mirror content into a Git repository (W3, G5); the page rules and roles of the application do not travel with a clone. This is an inference, not a documented statement. | Q3 no view restriction on Git content | **Consistent**: once the text is in Git, a reader of the repository is outside the application's rules. Neither tool's pages read say how they handle this. |
| Outline and BookStack are **additive** (the higher grant wins; BookStack grants win over denies at equal level); Confluence restrictions only **narrow** (B2, O1). | Q10 a rule on a child adds to the parent's | **Challenges nothing but shows a choice**: Kintsugi's edit rules narrow, as Confluence's do. The stories should say that two rules mean "both must allow". |
| BookStack cascades book and chapter overrides to children but not shelf overrides (B2). | Q10 the subtree | **Supports** a rule on a folder covering its subtree; shows a deliberate boundary at the top container. |
| GitBook's merge rules: a minimum number of reviews, all approvals, review by named actors, an up-to-date change request, bypass actors, set per organisation or per section (G4). | Q7 the pull request is the approval | **Adds a question**: whether required reviewers per space are a Kintsugi feature or left to the Git server's branch protection (the backstop already named). It gives the vocabulary if a later phase wants it. |
| Outline notifies every member of a mentioned group, with a per-group switch (O5); Confluence mentions teams of up to 50 (feature matrix, COL-11). | COL-11 mention a team (Won't) | **Adds a question** for later: mentioning an *access role* would need a rule on who may be notified, and ADR-0024 keeps roles away from projects. Stays Won't. |
| Docusaurus ships no comments, permissions or audit, and delegates them to plugins (D1). | Scope | A Git-first static site gives none of this; the collaboration area exists because Kintsugi has a portal and a database beside Git. |

The one added question is posted in the thread as Q15: whether required reviewers per space belong to Kintsugi or stay a Git-server setting. Until the architects answer, the pack assumes the second.

## Sources

| Key | Page | URL |
|---|---|---|
| W1 | Wiki.js: Users, Groups and Permissions (search summary of the page) | https://docs.requarks.io/groups |
| W2 | Wiki.js: comments (version 2.4 and later, external providers; search summary) | https://docs.requarks.io/ |
| W3 | Wiki.js: Git storage module (search summary of the page) | https://docs.requarks.io/storage/git |
| B1 | BookStack: email and webhooks | https://www.bookstackapp.com/docs/admin/email-webhooks/ |
| B2 | BookStack: roles and permissions | https://www.bookstackapp.com/docs/user/roles-and-permissions/ |
| B3 | BookStack: content storage | https://www.bookstackapp.com/docs/admin/content-storage/ |
| O1 | Outline: Collections | https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV |
| O2 | Outline: Users and roles | https://docs.getoutline.com/s/guide/doc/users-groups-cwCxXP8R3V |
| O3 | Outline: Groups | https://docs.getoutline.com/s/guide/doc/groups-Jy1rROTFmN |
| O4 | Outline: Security | https://docs.getoutline.com/s/guide/doc/security-DlJBglbImQ |
| O5 | Outline: API and changelog (comments, notifications, group mentions) | https://www.getoutline.com/developers |
| O6 | Outline: Administration | https://docs.getoutline.com/s/guide/doc/administration-GmaueCNdk1 |
| G1 | GitBook: Comments | https://gitbook.com/docs/collaborate/comments.md |
| G2 | GitBook: Roles | https://gitbook.com/docs/collaborate/member-management/roles.md |
| G3 | GitBook: Change requests | https://gitbook.com/docs/collaborate/change-requests.md |
| G4 | GitBook: Merge rules | https://gitbook.com/docs/collaborate/merge-rules.md |
| G5 | GitBook: Git Sync | https://gitbook.com/docs/docs-as-code/git-sync.md |
| D1 | Docusaurus: Guides (core delegates features to plugins) | https://docusaurus.io/docs/category/guides |
