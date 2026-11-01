# Collaboration and access: open questions

> Research pack, area 20-collaboration (ticket BC-004). The questions about the Markdown-only repo, Git as the source of truth, Postgres as the only datastore and the identity model, with the options, the decision and where it was taken. Decisions are the architects' (owner: sa-platform) in the thread `collab-constraints` on the fleet board, post "23:38 sa-platform · decision"; the board is not in the repo, so the decision text is repeated here. Related pages: [feature matrix](feature-matrix.md), [user stories](user-stories.md), [gap analysis](gap-analysis.md).

Rule behind all of them, from the architects: **reviewed page content in Git, conversation and per-user working state in Postgres, and the Brain indexes Git only.**

## Decided

| ID | Question | Options considered | Decision | Status |
|---|---|---|---|---|
| Q1 | Where do comments live? | (a) Postgres, anchored by page, Brain node id, quoted text and commit; (b) Markdown sidecar files in the repo; (c) the Git server's pull request comments only | **(a).** Orphaned comments (the quote is gone) show at the page end. Agents read comments through a separate tool, never inside `brain_read`. Tables in the `knowledge` schema with the prefix `wiki_`. | decided, thread 23:38 |
| Q2 | Where do watches, notifications and the inbox live? | (a) Postgres, delivered over the change feed to an inbox page; (b) plus an outbound channel (webhook, SMTP) | **(a).** `core.notification` and watches; a new change-feed topic whose scope is the user id and carries no content ([ADR-0059](../../../decisions/0059-live-updates-over-sse.md)). Email and webhook are an outbound dependency and wait for their own ADR. | decided |
| Q3 | Who enforces page and space restrictions? | (a) Postgres ACL for view and edit; (b) restricted pages as encrypted records; (c) a document repo per audience | **Changed to: (a) for edit only.** Edit and publish restrictions per space or path prefix in Postgres, checked by the API on draft and publish (a real control, since publishing goes through the writer; branch protection or CODEOWNERS on the Git server is the backstop). **No per-page view restriction on Git content**: everyone with Git read access, every member's clone and every mirror holds the text, and the Brain and change-feed paths would each need a filter that can leak. Viewing is bounded by Project Access ([ADR-0062](../../../decisions/0062-coding-agent-context-and-project-access.md)). (c) is rejected by [ADR-0028](../../../decisions/0028-remove-rulebook-single-document-repo.md). | decided |
| Q4 | Who can hold a space or page grant? | (a) users and access roles; (b) a new group concept; (c) project roles | **(a).** Project roles never grant ([ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md)); a grant never widens Project Access. | decided |
| Q5 | Brain and restrictions | (a) filter at read time; (b) a second tree; (c) leave view-restricted pages out of the index | **(c) follows from Q3:** no per-viewer trees; nothing view-restricted is in Git, so there is nothing to leak. | decided |
| Q6 | Co-editing | (a) not now: one draft per user and page, presence, optimistic lock on the base commit; (b) a CRDT service | **(a).** Presence is draft rows touched in the last two minutes, pushed on the change feed. Yjs over WebSocket is a new realtime service: Won't in the phases of this pack, its own ADR if the owner asks. | decided |
| Q7 | Approval of a page | (a) the pull request; (b) a governance gate; (c) both | **(a) now, (c) later.** The portal shows the pull request's state from `workflow.document_write`. | decided |
| Q8 | Mentions in committed text | (a) `@username`; (b) `@[user:<id>]` | **(a),** resolved at read time. Comments store the user id. | decided |
| Q9 | Audit | reuse `governance.audit_event`; audit reads of restricted pages; audit every view | Audit actions for comment delete, restriction and grant changes; **ordinary page reads are not audited** (view counts are telemetry, owned by the discovery area). | decided |

Constraint noted by the architects: the portal's document routes need a session only and do not check Project Access (`apps/api/src/modules/delivery/documents/interface/documents.controller.ts:2-4`); fixing them is a prerequisite for any wiki read route. Carried into the [gap analysis](gap-analysis.md#findings-to-carry-into-the-roadmap).

## Follow-ups posted by ba-collab

Posted in the same thread at 23:45 with defaults, answer by 01:15. Until answered, the pack assumes the default.

| ID | Question | Default assumed | Status |
|---|---|---|---|
| Q10 | Does an edit restriction on a folder prefix cover its subtree? (Confluence inherits view restrictions only, not edit.) | Yes, the subtree; a narrower restriction adds, never removes. The stories state the difference. | open |
| Q11 | A people directory for mentions, readable by any holder of Project Access (id, username, display name, no email), since `GET /users` needs `members.manage`. | New read route limited to Project Access holders. | open |
| Q12 | Agents and comments: a read tool for a node's comments in the member API and the MCP bridge, text treated as project data, not a `brain.read` record. | `GET /api/member/v1/comments` and `comments_list`, read-only. | open (sa-brain to confirm the anchor) |
| Q13 | Who may edit or delete another person's comment. | New code `wiki.moderate` (admin by seed), audited; authors edit and delete their own (delete only without replies). | open |
| Q14 | Authored restricted pages (encrypted Postgres records, no Git, no Brain; matrix row COL-27): roadmap candidate or dropped. | A late-phase Should candidate with its own ADR, the decision left to the product owner. | open, for the owner |

## For the product owner

Three points are choices of priority, not of architecture:

1. **View restriction is the one Confluence behaviour Kintsugi will not match on Git content (COL-26).** A migration team that must keep a customer's personal-data findings from part of the project has two honest answers: do not put them in the wiki (the existing restricted records), or fund COL-27. Q14 asks which.
2. **Email notifications (COL-16) wait for an ADR** that accepts an outbound dependency. Until then the in-app inbox is the only channel, which suits a portal people already keep open but not people who live in their mail.
3. **Co-editing is declined, with presence and a three-way publish instead** (Q6). Say so if a stakeholder expects Confluence's live docs.
