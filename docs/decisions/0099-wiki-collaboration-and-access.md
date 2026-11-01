# ADR-0099: Wiki comments, watches and notifications live in Postgres; wiki access is edit rules on paths, with Project Access as the view boundary

- Status: Proposed
- Date: 2026-11-02
- Decision register: D113

## Context

A Confluence-like wiki lets people comment on a page or a passage, mention one another, watch pages and spaces, receive notifications and restrict who may view or edit a page or a space ([Confluence-like wiki research](../research/confluence-parity/40-architecture/constraints-and-fit.md)). Kintsugi keeps the text of every page in the project's one document repository ([ADR-0007](0007-git-as-source-of-truth.md), [ADR-0028](0028-remove-rulebook-single-document-repo.md)) and Postgres as its only datastore ([ADR-0010](0010-postgres-only.md)). Access is the permission catalog: codes added by migration and granted through installation-wide access roles; project roles are RACI and never grant ([ADR-0008](0008-authentication.md), [ADR-0024](0024-access-roles-vs-project-roles.md)); Project Access is explicit per project and user, all or nothing ([ADR-0062](0062-coding-agent-context-and-project-access.md)). Live views learn of changes through a change feed that carries a topic and a scope, never content ([ADR-0059](0059-live-updates-over-sse.md)). There is no comment, mention, watch or notification mechanism today, and no outbound mail.

Two facts shape access. Everyone who can read the document repository on the Git server, every member's local clone and every mirror holds the full text of every page, so a rule inside Kintsugi cannot hide a page's text from them. And the Brain indexes one branch for the whole project ([ADR-0091](0091-brain-vectorless-tree-index.md)): filtering it per viewer would need a filter on every tree, read, lookup, grep, link and change answer, and each one is a place to leak. Today the portal's document routes need a session only, while the member API checks Project Access.

## Decision

1. **Comments are Postgres rows.** A comment belongs to a project and a page id and is anchored to a Brain node (a heading anchor or a card id), a quoted passage and the commit it was written on. On read it is re-anchored by its quote at the current commit; a comment whose quote is gone is shown at the end of the page as *orphaned*. Replies, resolve and reopen, and reactions are rows of the same kind. Comments are never written to Git and never read by `brain_read`; members' agents read the open threads of a page with a separate read tool, `page_comments`.
2. **Mentions.** In a page body a mention is the plain text `@username`, resolved when the page is rendered; in a comment it is stored as the user id. A mentioned person is told only if they have Project Access.
3. **Watches and notifications.** A person watches a page, a folder or a space (`knowledge.wiki_watch`). A notification is a row of `core.notification` (recipient, kind, subject, read flag; never the page text), shown in a portal inbox and announced on the change feed with the topic `notifications` and the recipient's id as scope. Comment and mention notifications are created with the comment; change notifications are created by the worker after a Brain build of the default branch, from the documents that changed between the two indexed commits, through its outbox so each change notifies once; this also covers changes members push from their own clones. Mail, chat and webhooks are not part of this decision.
4. **Viewing is bounded by Project Access to the whole repository.** A person with Project Access may read every page of the project; the wiki adds no per-page or per-space view restriction for content in Git. Every wiki and document read route checks Project Access, as the member API does; the existing portal document routes are brought in line before the wiki ships.
5. **Editing is bounded by permissions and space rules.** New permission codes, added by migration: `wiki.comment` (comment and reply), `wiki.write` (draft and publish for review), `wiki.publish` (direct publication on `directPublishPaths`, [ADR-0098](0098-wiki-page-editing-and-publishing.md)) and `wiki.manage` (spaces, space rules, moderation of comments). A space rule (`knowledge.wiki_space_rule`) limits who may write under a path prefix to listed users and access roles; project roles are never subjects, and a rule never widens Project Access. The API checks the rules on every draft save and publish. The Git server's branch protection remains the gate for changes made outside Kintsugi.
6. **Approval is the pull request.** A page published for review is approved by merging its pull request; the portal shows its state from `workflow.document_write`. A gate per page is not part of this decision.
7. **Audit.** Publish, page delete, comment deletion by a moderator, and space rule changes are recorded in `governance.audit_event`. Ordinary page reads are not audited; page views are counted per page and day in `monitoring`, without user ids by default, under the telemetry retention.
8. **No co-editing.** Several people editing one page at once see each other's presence and resolve their edits with the three-way merge of ADR-0098; there is no real-time co-editing service.

## Consequences

- Conversation and per-person state never need a pull request, and the repository keeps only reviewed text.
- The Brain stays one tree per project and needs no per-viewer filter; a member's agent sees what the member can read in Git.
- Content that only some members of a project may read cannot be a wiki page. Such content needs a later decision, for example *restricted pages* stored encrypted in Postgres as an extension of restricted records (`restricted.read`, fail-closed audit, never in Git or the Brain). Teams used to Confluence's page restrictions will notice the difference; the portal says so where restrictions would be expected.
- Comment anchors drift when a passage is rewritten; re-anchoring by quote keeps most of them, and orphaned comments stay visible rather than lost.
- New work: the comment, watch and rule stores and services in the wiki module, the `core` notifications module and inbox, the worker's watch fan-out after a Brain build, four permission codes and their migration, audit actions, the Project Access check on the document routes.

## Alternatives considered

- **Comments as Markdown sidecar files in the repository.** Rejected: every comment would need a write and, outside `directPublishPaths`, a pull request; discussion would flood the history and the Brain.
- **Comments only as pull-request comments on the Git server.** Rejected: they exist only while a change is under review, differ by server, and cannot be anchored to a published page.
- **A Postgres view ACL per page or space over content in Git.** Rejected: it is not a control, because the text is in every Git reader's clone, and it would need a leak-free filter on every Brain answer.
- **A separate document repository per audience.** Rejected: [ADR-0028](0028-remove-rulebook-single-document-repo.md) keeps one document repository per project, and the Brain, the writer and the layout assume it.
- **Project roles or new groups as grant subjects.** Rejected: project roles never grant ([ADR-0024](0024-access-roles-vs-project-roles.md)); access roles already group people, and a second grouping concept would duplicate them.
- **Mail notifications now.** Rejected for now: Kintsugi has no mail dependency ([ADR-0008](0008-authentication.md)); an outbound channel stores a credential and needs its own decision.
