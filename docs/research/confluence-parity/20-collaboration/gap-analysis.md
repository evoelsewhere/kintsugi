# Collaboration and access: gap analysis

> Research pack, area 20-collaboration (ticket BC-003). What Kintsugi has today for each row of the [feature matrix](feature-matrix.md), the gap and the smallest step that closes it, followed by the mapping of Confluence's permission levels onto Kintsugi's identity model, the state that cannot live in Git, and the recommendation on real-time co-editing. Facts about the code were read on the `master` branch at commit `07c2685c`; decisions of the architects are those of the thread `collab-constraints` ([open questions](open-questions.md)).

## What Kintsugi has today

| Building block | Where | What it gives collaboration |
|---|---|---|
| Identity and access | `core.app_user`, `core.role`, `core.role_permission`, `core.user_role`, `core.permission` (`apps/api/migrations/002_identity.sql`); [ADR-0008](../../../decisions/0008-authentication.md), [ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md) | Installation-wide **access roles** (primary `admin`, `contribute`, `user`; admin-defined sub-roles such as `ba`, `dev`, `tester`) bundling permission codes. A new code is a migration and shows in the portal by itself. |
| Project Access | `admin.project_access` (migration 019), `apps/api/src/modules/admin/project-access/`, [ADR-0062](../../../decisions/0062-coding-agent-context-and-project-access.md) | Explicit grant per project and user, all or nothing, managed with `project.access.manage`. Checked on every member-token route (`apps/api/src/modules/core/auth/interface/auth.guard.ts`, `requireRead`). |
| Project roles | `ProjectRole` in `@kintsugi/domain`, [ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md) | RACI vocabulary (`pm`, `architect`, `ba`, ...). Never a grant. Project membership is "planned with M0 project persistence" ([data model](../../../reference/data-model.md)). |
| Document reads | `apps/api/src/modules/delivery/documents/interface/documents.controller.ts`, [write path](../../../reference/document-repo-write-path.md), [Brain](../../../reference/brain.md) | The portal's document routes need a **session only** (no permission, no Project Access); the member API and the Brain's member reads need `member.read` plus Project Access. |
| Document writes and review | `apps/api/src/modules/admin/document-writes/`, `services/orchestrator/src/document-write/` | One write per document repo at a time; direct commit only for `autoCommitPaths`, else a `kintsugi/<actor>/<write-id>` branch and a pull request; the worker watches it until `merged` or `closed`. |
| Audit | `governance.audit_event` (append-only), `apps/api/src/common/audit/audit-trail.ts` (`AUDIT_ACTIONS`), [data model](../../../reference/data-model.md#audit-log) | One port; entries after a change, or fail-closed before a sensitive read. No retention setting and no export. |
| Restricted records | `governance.restricted_record`, `restricted.read`, [security](../../../architecture/concepts/security.md#audit) | Encrypted in Postgres, never in Git, the Brain or logs; each read audited before the content returns. Written by jobs only. |
| Live updates | `apps/api/src/common/realtime/change-feed.ts`, `GET /api/events`, [ADR-0059](../../../decisions/0059-live-updates-over-sse.md) | Postgres `NOTIFY` to one SSE stream per tab; carries topic and scope only, never content. |
| Gates | `governance.gate`, `gates.request`, `gates.decide`, [data model](../../../reference/data-model.md#gates) | A decision recorded in the portal with a note; for stages and quality gates, not pages. |
| Brain | `knowledge.brain_*` (migration 043), [ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md) | Stable node ids and line ranges at a commit: the natural anchor for a comment. One tree per project branch, not per viewer. |

There is **no** comment, mention, watch, notification, share or space concept anywhere in `apps/api/src`, `packages/domain/src` or the portal, and no mail sender ([ADR-0008](../../../decisions/0008-authentication.md) has no email dependency).

## Row by row

Smallest step = the least that makes the row true, not the target design (see the architecture pages for that). The state each step needs is named: *Postgres* (conversation or per-user state, decided in the thread), *Git* (reviewed page text), *code* (API or portal change only).

| ID | Existing mechanism | Gap | Smallest step |
|---|---|---|---|
| COL-01 | None. Review talk happens on the Git server's pull request. | Page-level conversation. | Table `knowledge.wiki_comment` (project, page path, author user id, body Markdown, parent id, timestamps); list and create routes; a thread under the page in the portal. Postgres. |
| COL-02 | Brain node ids and line ranges at a commit give anchors. | Anchored comments that survive edits. | Add to the comment row: node id, quoted text, commit; on read, re-anchor by the quote, show orphaned comments at the page end (decided). Postgres. |
| COL-03 | None. | Resolve and reopen. | A `resolved_by`/`resolved_at` pair on the comment and a filter. Postgres. |
| COL-04 | `AUDIT_ACTIONS` for the delete record. | Edit and delete rules. | Author edits and deletes own comments (delete only without replies); `wiki.manage` deletes any, audited as `wiki.comment.delete`. Postgres + code. |
| COL-05 | None; needs drafts (authoring area). | Draft-only comments. | A `draft_id` on the comment, hidden from others until publish. Do after drafts exist. Postgres. |
| COL-06 | None. | Reactions. | A reaction table; skip in the first phase. Postgres. |
| COL-07 | `_build/review.md` written by the review job; Brain read tools return no conversation. | Agents cannot see open comments. | A separate read tool beside the Brain tools (`comments_list` for a node, with its citation), never inside `brain_read` (decided). Code in the member API and the MCP bridge. |
| COL-08 | `GET /users` needs `members.manage`. | A directory an ordinary member may read; the mention itself. | A read-only people list limited to holders of Project Access for the project; `@username` resolved at read time; a comment stores the user id (decided). Code + Postgres. |
| COL-09 | None. | First-mention rule. | Record (page, mentioned user) once; notify only when new. Postgres. |
| COL-10 | `ProjectAccessService.requireRead` (member routes only). | Applying it to notification targets. | Before writing a notification, drop users without Project Access to the project. Code. |
| COL-11 | None, and ADR-0024 forbids a project role as a grant subject. | A team to mention. | Not needed; mention people. If wanted later: mention an *access role* (installation-wide), which is a different thing from a team. Won't. |
| COL-12 | Unit tasks are files (`task.md`). | Tasks inside a page. | A comment with an `assignee` and `done` flag; list "assigned to me" in the inbox. Postgres. |
| COL-13 | None. | Watches. | Table `core.watch` (user, project, path prefix or page, kind). Postgres. |
| COL-14 | None. | Autowatch. | Create a watch when a user publishes or comments, unless their preference is off. Code. |
| COL-15 | SSE change feed (topic and scope only). | Persisted per-user inbox. | `core.notification` (user, kind, project, subject, created, read); a new change-feed topic whose scope is the user id; an inbox page. Postgres + code. |
| COL-16 | None; no mail sender. | Email. | Deferred behind its own ADR (outbound dependency). Nothing now. |
| COL-17 | None. | Preferences and watch list. | A per-user preference row and a page listing watches. Postgres. |
| COL-18 | See COL-10. | Same. | Same step as COL-10, tested with a negative case. Code. |
| COL-19 | Session-only document routes. | Share. | A "notify with link" action that writes notifications; it grants nothing (a share never widens Project Access). Code. |
| COL-20 | `project.access.manage` holders grant access. | Request from the page. | A notification to the managers with a link to Project Access; later. Code. |
| COL-21 | No anonymous route exists. | Public links. | None; decide by ADR if ever wanted. Won't. |
| COL-22 | Access-role permission codes plus Project Access. | A space level and a content level. | See [permission mapping](#permission-mapping). Postgres + code. |
| COL-23 | `core.role` and `core.role_permission` model the bundle; `core.user_role` the assignment. | Rules per space. | A space rule (`knowledge.wiki_space_rule`): project, path prefix, subject user or access role, level `edit` or `manage`. Commenting is a permission code, not a per-space level. A rule never widens Project Access. Postgres. |
| COL-24 | Flat permission catalog by migration. | Fine-grained operations. | Four installation codes by migration, as ADR-0099 names them: `wiki.comment`, `wiki.write` (draft and publish for review), `wiki.publish` (direct publication on the configured paths), `wiki.manage` (spaces, rules, comment moderation). Split further only on demand. Migration. |
| COL-25 | `autoCommitPaths` chooses commit or pull request. | Edit restriction. | A space rule on a path prefix (see COL-23), checked by the API on every draft save and publish (decided); branch protection or CODEOWNERS on the Git server is the Git-level backstop. Postgres + code. |
| COL-26 | None, and rejected for Git content (decided). | View restriction. | None for pages in the shared repo. Replacement: COL-27. Won't. |
| COL-27 | `governance.restricted_record`, `restricted.read`, fail-closed audit. | Authored restricted pages. | Extend restricted records so a person can author one in the portal; never in Git or the Brain. Own ADR; the owner decides whether the need is real. Postgres. |
| COL-28 | None. | The invariant. | A test: no rule yields more than Project Access; a rule on a child adds to its parent's, and a writer must satisfy both (decided). Code. |
| COL-29 | None. | Listing the rules in force. | A query over the space rules under a prefix, for `wiki.manage`. Code. |
| COL-30 | Admins hold all permissions by seed (`002_identity.sql`). | A recorded override. | An admin may clear a rule; audited as `wiki.rule.clear` with the admin as actor. Code. |
| COL-31 | `core.role`, `core.user_role`; sub-roles defined by admins. | A rule for a set of people. | Allow an access role as a rule subject (decided); no new group concept. Code. |
| COL-32 | None; Git is the source of truth. | Real-time co-editing. | Not in the phases of this pack; see [the recommendation](#real-time-co-editing). |
| COL-33 | Change feed can push to the portal. | Presence. | A draft row touched in the last two minutes is "editing"; push on a topic with the page as scope (decided). Postgres + code. |
| COL-34 | The writer fetches, rebases and retries; a conflict fails the write. | A conflict a person can resolve. | Publish carries the base commit; if the page moved, show a three-way diff and ask. Code in the portal; the writer already rejects. |
| COL-35 | Pull request and `workflow.document_write` states; `governance.gate`. | Named approvers in the portal. | Show the pull request's state and reviewers from the Git server; a gate only for spaces that require approval (later). Code. |
| COL-36 | Git history per file; `brain_changes`; Brain `changed`. | A person-facing history. | Authoring area; here only: show author and date from the Git log beside each page. Code. |
| COL-37 | `governance.audit_event`, `AuditTrail`. | New actions; retention; export. | Add the actions ADR-0099 names: `wiki.publish`, `wiki.page.delete`, `wiki.comment.delete`, `wiki.rule.set`, `wiki.rule.clear`. Retention and CSV export are separate, optional. Code. |
| COL-38 | `restricted.read` audited fail-closed. | Only for COL-27. | Same pattern for restricted pages. Ordinary reads are not audited (decided). Code. |
| COL-39 | `member-activity`, `brain.read` records. | Per-page views. | Owned by the discovery area; collaboration needs only a privacy decision on per-person views. Code. |

## Permission mapping

Confluence combines three levels. Kintsugi's identity model has two kinds of "role" that [ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md) keeps apart, plus Project Access. The mapping below uses **only existing concepts** or names the code or table a gap would need.

| Confluence level | What it decides | Kintsugi concept it maps to | Existing or new |
|---|---|---|---|
| Global permission (use the product, create spaces, administer) | What a person may do in the whole installation | **Access role** permission codes (`core.permission`, `core.role_permission`). Create a space: a new code `wiki.manage`. | Existing mechanism; new codes by migration. |
| Site and space *view* | Who can see a space and its pages | **Project Access** (`admin.project_access`): all or nothing for the project's document repo. A space inside the repo (a folder) is visible to every holder of Project Access. | Existing. The portal's document routes do not check it today (`documents.controller.ts` needs a session only): fixing them is a prerequisite. |
| Space role *Viewer* (read, comment) | Read and comment | Project Access plus the access role's `wiki.comment`, without `wiki.write`. | New code. |
| Space role *Collaborator* (create and edit) | Add and edit pages | The access role holds `wiki.write`; a space rule may narrow writing under a path to a list. Publishing still passes through the writer and its pull request; direct publication needs `wiki.publish` on a configured path. | New codes and rule table. |
| Space role *Manager* and *Admin* | Manage people, content, settings | `wiki.manage` (spaces, rules, moderation of comments). Installation `admin` already holds every code by seed. | New code. |
| Space rule for a *group* | Many people at once | An **access role** (including admin-defined sub-roles such as `ba`, `dev`, `tester`) as the subject of a rule. | Existing roles; new rule table. |
| Content *edit* restriction (page or subtree; not inherited by children in Confluence) | Who may change this page | A space rule on a path prefix, checked on every draft save and publish. Kintsugi's version applies to the subtree (a folder), because the unit of a page tree is a path; the difference from Confluence is stated in the stories. | New table; enforced by the API (a real control). |
| Content *view* restriction (inherits down) | Who may read this page | **Not offered** on Git content (decided): Project Access is the boundary. Authored restricted pages as encrypted records are the replacement, subject to its own ADR. | Gap by decision. |
| Anonymous access, public link | Readers without an account | None. | Won't. |
| Admin key (override) | Recover content | `admin` access role. | Existing; audit the override. |

What [ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md), [ADR-0008](../../../decisions/0008-authentication.md) and [ADR-0062](../../../decisions/0062-coding-agent-context-and-project-access.md) **forbid or make unsafe** here, so the architecture and stories avoid them:

1. **A project role is never a subject of a rule.** "Architects may edit `02-architecture/`" cannot be expressed with the RACI role `architect`; equal strings do not map (an access sub-role `ba` and the project role `ba` are different things). A space rule names users or access roles.
2. **A rule never widens Project Access.** A user named in a space rule but with no Project Access sees nothing; assignment, mention or share is not an access grant (ADR-0062 decision 1).
3. **Identity-provider claims do not define roles or rules** (ADR-0008 as amended). A future Entra ID group is not a space subject unless the roles are first mapped inside Kintsugi.
4. **No inference from the Git server.** Who may push or approve a pull request on the server is the server's setting; Kintsugi may show it but must not treat it as its own permission.

## State that cannot live in Git

The document repo keeps reviewed page text only (Markdown and front matter, [ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md)). Everything below changes without review, belongs to a person, or must stay hidden from a clone, so it lives in Postgres ([ADR-0010](../../../decisions/0010-postgres-only.md)):

| State | Why not Git |
|---|---|
| Comments and replies, resolve flags, assignees | Conversation, not a document; a pull request per comment would make commenting unusable. |
| Watches, autowatch and notification preferences | Per person, change constantly, private. |
| Notifications and the read marker | Per person, high volume, expire. |
| Drafts and presence | Work in progress by one person, not yet reviewed (authoring thread, Q1). |
| Space rules (who may write under a path) | They govern who may publish; a rule kept in the repo could be changed by the person it restricts through an ordinary pull request. Git server settings (branch protection) are the backstop, not the record. |
| Audit entries | Append-only by trigger ([data model](../../../reference/data-model.md#audit-log)). |
| Views and reads | Telemetry, never page content; owned by the discovery area. |
| Restricted pages (if ever offered) | Must not reach any clone, mirror or Brain. |

The rule the architects gave: reviewed page content in Git, conversation and working state in Postgres, and the Brain indexes Git only.

## Real-time co-editing

**Recommendation: do not build it in the phases of this pack (Won't), and offer presence, optimistic publish and a three-way merge instead.**

Reasons:

1. **Git is the source of truth** ([ADR-0007](../../../decisions/0007-git-as-source-of-truth.md)). Live co-editing needs a shared document state between two keystrokes (a CRDT or operational-transform service on a socket). That state would sit in Postgres until a publish turns it into a commit, so the text has two homes for as long as people type. The Brain and every member's agent see only the published commit, so they would disagree with the screen.
2. **Confluence itself does not offer it everywhere.** Its documentation describes simultaneous editing for *live docs* (up to 40 editors, a version finalised 10 to 15 minutes after the last edit) and does not document simultaneous editing, presence or conflict handling for standard pages ([S15](feature-matrix.md#sources)). Parity does not require it.
3. **New infrastructure.** A realtime service is a new moving part for a self-hosted, single-datastore installation ([ADR-0010](../../../decisions/0010-postgres-only.md), AGENTS.md: no infrastructure without an ADR).
4. **The review model already exists.** The writer's pull request, its fast-forward-only push and its retry and rebase ([write path](../../../reference/document-repo-write-path.md)) are a review and merge workflow. Co-editing without review would bypass what reviewers rely on.

What closes most of the need cheaply: an "editing now" marker (a draft row touched in the last two minutes, pushed over the change feed), a check of the base commit at publish, and a three-way diff when the page moved. If the owner wants co-editing later, it needs its own ADR that states where the interim state lives, what the Brain sees and how a conflict with a merged pull request ends.

## Findings to carry into the roadmap

1. **Prerequisite, before any wiki route:** make the portal's document routes check Project Access (today a session is enough), or the first wiki route repeats the hole. Evidence: `apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`.
2. A **people directory** readable by ordinary members (mentions, sharing) does not exist; `GET /users` needs `members.manage`.
3. Four **permission codes** (`wiki.comment`, `wiki.write`, `wiki.publish`, `wiki.manage`) and the **tables** of the comment, watch and space rule, plus `core.notification`, are the whole identity delta. Names follow ADR-0099; the data model is owned by the architects.
4. The audit needs five **new actions** and nothing else; its missing retention and export are an independent improvement.
5. **No email** until an ADR accepts an outbound channel; the in-app inbox is the first delivery.
6. **View restriction** is the one Confluence behaviour that Kintsugi will not match on Git content. The open question for the owner is whether authored restricted pages (COL-27) justify their own ADR.
