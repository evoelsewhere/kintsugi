# Collaboration and access: user stories

> Research pack, area 20-collaboration (ticket BC-002). User stories with Given/When/Then criteria for every Must and Should row of the [feature matrix](feature-matrix.md). Personas are the contract's: `member`, `manager`, `admin`, `viewer`, `agent` (a member's agent reading through the Brain). The criteria respect the decisions in [open questions](open-questions.md): reviewed page text in Git, comments, watches, notifications and restrictions in Postgres, no per-page view restriction on Git content, grants to users and access roles only. Where a story depends on a question that is still open, it says so.

Conventions: a **page** is a Markdown document in the project's document repo; a **space** is a folder of it. "Has Project Access" means a row in `admin.project_access` for the user ([ADR-0062](../../../decisions/0062-coding-agent-context-and-project-access.md)). An **access role** is a Kintsugi role such as `contribute` or `ba`, never a RACI project role ([ADR-0024](../../../decisions/0024-access-roles-vs-project-roles.md)). Priorities repeat the matrix row.

## Comments

### COL-US-01 Comment on a page (COL-01, M)
As a `member`, I want to ask a question under a page and get replies in a thread, so that I settle it where the reader is without opening a pull request.
- Given I have Project Access and the permission `wiki.comment`, When I post a comment on `02-architecture/blueprint.md`, Then it appears under the page with my name and time, and no commit and no pull request are created.
- Given a comment exists, When another member replies, Then the reply shows under it in order and the thread keeps its parent.
- Given I do not have Project Access to the project, When I request the page's comments, Then the answer is 403 and no comment text is returned.
- Given a comment is stored, When the Brain tree of the project is read, Then no comment appears in any node, summary or grep hit (comments are not documents).

### COL-US-02 Comment on a passage (COL-02, M)
As a `member`, I want to comment on one rule or table row, so that the discussion is tied to the lines in question.
- Given I select the text of a section, When I choose Comment and post, Then the comment stores the page, the Brain node id (heading anchor or card id), the quoted text and the commit it was written on.
- Given the page is changed by a merged pull request and the quoted text is still there, When the page is opened, Then the comment is shown next to that text at its new position.
- Given the quoted text no longer exists in the page, When the page is opened, Then the comment is listed at the end of the page as orphaned with its quote, and is not deleted.
- Given the page was moved to another path in Git, When the page is opened at its new path, Then its comments follow it (open question for the authoring page-identity decision: they follow the page id when the page has one, and are orphaned when it does not).

### COL-US-03 Resolve a thread (COL-03, S)
As a `manager`, I want to resolve an inline comment thread, so that the open threads are the review's work list.
- Given an open inline comment, When I choose Resolve, Then the thread leaves the default view, shows under a Resolved filter and records who resolved it and when.
- Given a resolved thread, When I choose Reopen, Then it returns to the open list.
- Given a reply to an inline comment, When I look for Resolve on the reply, Then there is none (the thread is resolved as a whole, as Confluence does).

### COL-US-04 Edit and delete comments (COL-04, S)
As a `member`, I want to correct or delete my own comment, so that a mistake does not stay on the page.
- Given I wrote a comment with no replies, When I delete it, Then it is gone from the page and one audit entry `wiki.comment.delete` records who deleted which comment, never its text.
- Given my comment has replies, When I try to delete it, Then I am refused and offered Edit.
- Given someone else wrote a comment and I do not hold `wiki.manage`, When I try to edit or delete it, Then I am refused (403) and nothing changes.
- Given I am an `admin` and hold `wiki.manage`, When I delete an inappropriate comment, Then it is removed and the audit entry names me as actor.

### COL-US-07 An agent reads the open comments (COL-07, S; open question Q12)
As an `agent` acting for a member, I want the open comments on the page I am about to change, so that I do not repeat a question or ignore a decision.
- Given the member's token is scoped to the project and the member has Project Access, When the agent calls `comments_list` for a node id, Then it receives the open comments of that node, each with its author name, date and the citation of the anchor (`path:lines@commit`).
- Given the same call, Then the text is returned marked as project data, not as instructions, like the Brain's text.
- Given a token scoped to another project, When the agent calls `comments_list`, Then the answer is 403 ("Token is not scoped to this project").
- Given the agent calls `brain_read` on the same node, Then the answer holds the page text only, never a comment.

## Mentions

### COL-US-08 Mention a colleague (COL-08, M; open question Q11)
As a `member`, I want to type `@` and choose a colleague, so that they are told to look.
- Given I type `@` in a comment, When the list opens, Then it offers only users who hold Project Access to this project, by display name and username, without e-mail addresses.
- Given I choose a colleague and post, Then the comment stores their user id, the text shows their display name, and they get one notification in their inbox.
- Given I write `@username` in a page body that I publish, Then the committed Markdown holds the text `@username` (not an id), and the portal renders it as a link to the person, resolved when the page is read.
- Given a user is not in the list (no Project Access), When I type their username by hand, Then no notification is created for them.

### COL-US-09 One notification per person per page (COL-09, S)
As a `member`, I want not to be notified again each time I am mentioned on the same page, so that my inbox stays useful.
- Given I was mentioned on a page and I have a notification for it, When the same page mentions me again, Then no second mention notification is created.
- Given I was never mentioned on a page, When a comment mentions me, Then exactly one is created.

### COL-US-10 A mention never leaks (COL-10, M; COL-18, M)
As an `admin`, I want a notification to reveal nothing to a person who cannot read the project, so that a mention is not a way around access.
- Given a comment mentions a user who lost Project Access yesterday, When the comment is posted, Then no notification row is created for them.
- Given a user has Project Access to project A only, When a comment on project B mentions their username, Then they receive nothing.
- Given a notification exists for a user and their Project Access is later revoked, When they open the inbox, Then the notification no longer lists its subject or text.

## Watching and notifications

### COL-US-13 Watch a page or a space (COL-13, M)
As a `member`, I want to watch a page or a folder, so that I hear when it changes.
- Given I have Project Access, When I choose Watch on a page, Then I am listed as a watcher and a change to the page (a merged pull request that touches it, a new comment) creates a notification for me.
- Given I watch a space (a folder), When a page below it is merged, Then I get one notification naming the page, not one per commit.
- Given I do not have Project Access, When I try to watch a page of the project, Then the request is refused (403).
- Given a watched page is deleted by a merged pull request, Then I get a notification that it was deleted, with the last known title.

### COL-US-14 Watch what I wrote (COL-14, S)
As a `member`, I want pages I publish or comment on to be watched for me, so that I see replies without setup.
- Given autowatch is on (the default), When my pull request for a page merges or I post a comment, Then I am a watcher of that page.
- Given I switch autowatch off in my preferences, When I comment, Then no watch is created.

### COL-US-15 An inbox in the portal (COL-15, M)
As a `member`, I want one list of what needs me, so that I do not hunt through pages and pull requests.
- Given I have notifications, When I open the inbox, Then they are listed newest first with an unread marker, the page, the actor and a link to the anchor.
- Given a new notification is created for me while the portal is open, Then the inbox updates within a few seconds over the live stream, which carries only a topic and my user id, never the notification text.
- Given I choose Mark all as read, Then every notification is read and the unread count is zero.
- Given a notification is older than 30 days (a retention to confirm), Then it is no longer listed.
- Given another user, When they request my inbox, Then they get 403 or an empty list, never my notifications.

### COL-US-17 Preferences and my watches (COL-17, S)
As a `member`, I want to see and change what I follow, so that I control the noise.
- Given I open Settings, When I look at Watches, Then I see every page and space I watch and can remove each.
- Given I switch "notify me about my own actions" off, When I comment, Then I get no notification for it.

## Sharing

### COL-US-19 Send a colleague to a page (COL-19, S)
As a `member`, I want to share a page with a colleague with a note, so that they open it at once.
- Given the colleague has Project Access, When I choose Share and add a note, Then they get a notification with my note and a link, and nothing about their access changes.
- Given the colleague does not have Project Access, When I try to share, Then the dialog says they cannot read this project and offers no way to grant it (Project Access is granted by a holder of `project.access.manage`).

## Permissions and restrictions

### COL-US-22 One rule for who may do what (COL-22, M)
As an `admin`, I want a stated order of checks, so that I can predict what any user can do.
- Given a user, When they ask to read a page, Then the check is Project Access first; with none, the answer is 403 whatever role they hold.
- Given a user with Project Access, When they ask to comment, edit or manage, Then the checks are the access role's permission code and then, if the space has grants or restrictions, the grant.
- Given a user's project role (RACI) is `architect`, When the system decides whether they may edit a space, Then the project role is not consulted (ADR-0024).

### COL-US-23 A space with its own people (COL-23, M)
As a `manager`, I want a space where only named people publish, so that the standards are not changed by everyone.
- Given I hold `wiki.manage`, When I grant the access role `ba` the level `edit` and the user Dana the level `comment` on the space `01-standards/`, Then the grants are stored and one audit entry per grant (`wiki.space.grant`) names me, the subject and the level.
- Given Dana holds only `comment` on that space, When she tries to publish a change there, Then she is refused (403) and no draft is published.
- Given a user holds a grant on the space but has no Project Access to the project, When they open the space, Then they get 403: a grant never widens Project Access.
- Given I try to grant the project role `pm` as a subject, Then the request is refused: only users and access roles are subjects.

### COL-US-24 Separate who may comment from who may edit (COL-24, S)
As an `admin`, I want separate permissions for commenting, editing and managing (which includes moderating), so that I can give a reviewer comment rights only.
- Given the catalog, When I open Members and permissions, Then `wiki.comment`, `wiki.edit` and `wiki.manage` are listed in their own group with a description, added by migration.
- Given an access role holds `wiki.comment` but not `wiki.edit`, When a user of that role opens the editor on a page, Then Save and Publish are not offered and the API refuses a publish.

### COL-US-25 Only the owners may change a rule (COL-25, M; open question Q10)
As a `manager`, I want an edit restriction on a folder, so that only its owners can publish there.
- Given I hold `wiki.manage`, When I restrict editing of `02-architecture/` to the users Lee and Sam, Then a restriction row for the path prefix and one audit entry (`wiki.restriction.set`) are stored.
- Given the restriction, When a user who is not listed starts a publish of a page below that path, Then the API refuses it (403) at publish and nothing is written to the document repo.
- Given the restriction, When a listed user publishes, Then the normal write path runs (a pull request unless the path auto-commits).
- Given the restriction covers the folder, When a user tries to publish a page in a subfolder, Then they are refused as well (assumed answer to Q10: it covers the subtree).
- Given a person with direct Git push rights on the server edits the file outside Kintsugi, Then the restriction does not stop them: the page states that branch protection on the Git server is the backstop.

### COL-US-27 A page some members must not see (COL-27, S; open question Q14)
As a `manager`, I want to keep a page from part of the project, so that sensitive findings do not reach every member.
- Given I create a restricted page for a list of users, When the page is saved, Then it is stored encrypted in Postgres and no file is created in the document repo and no pull request is opened.
- Given the page exists, When a user not on the list requests it, Then they get 403, and the page is absent from the page tree, the search results and the Brain tree and grep (a restricted page is never indexed).
- Given a listed user opens the page, Then one audit entry records the read **before** the content is returned; when the entry cannot be written, nothing is returned.
- Given a member runs `kintsugi init` and clones the document repo, Then the page is not in the clone.

### COL-US-28 A restriction can only narrow (COL-28, M)
As an `admin`, I want the system to refuse a restriction that contradicts the rest, so that nobody is locked in by mistake.
- Given a space grants `edit` to the access role `ba`, When a restriction on a page lists only Lee, Then only Lee may edit the page, and `ba` members may still read and comment.
- Given a restriction would remove the reading right of a user while keeping their edit right, Then it is refused with the reason.
- Given a restriction names a user, When the user does not hold the space level `edit`, Then the restriction does not grant it (no grant, restriction or share gives more than Project Access plus the space level).

### COL-US-29 Find the restrictions in force (COL-29, S)
As a `manager`, I want a list of every restriction in a space, so that I can clear the stale ones after people leave.
- Given restrictions exist, When I open the space settings, Then I see each path prefix, its mode, its subjects and who set it and when.
- Given a listed user was disabled, Then the row shows them as disabled.
- Given I hold `wiki.manage`, When I clear a restriction, Then it is removed and `wiki.restriction.clear` is audited.

### COL-US-31 Grant to a role instead of to each person (COL-31, S)
As an `admin`, I want to grant a space level to an access role, so that new members inherit it.
- Given the access role `tester` has the level `comment` on a space, When a user is given the role `tester` and has Project Access, Then they can comment there without a grant of their own.
- Given the user also holds a role without the grant, Then the highest level among their roles applies (grants add up, as in Confluence).
- Given the role is deleted, Then its grants are removed with it.

## Co-editing, review and approval

### COL-US-33 See who is editing (COL-33, S)
As a `member`, I want to see that a colleague is editing a page, so that we do not edit the same page.
- Given Alex has a draft of the page open and saved it in the last two minutes, When I open the page, Then I see "Alex is editing".
- Given Alex's last save is older than two minutes, Then the marker is gone.
- Given the change stream, Then the marker appears and disappears without reloading, and the stream carries the page as scope but not Alex's text.

### COL-US-34 Never lose an edit (COL-34, M)
As a `member`, I want to be told if the page changed while I edited, so that my work is not overwritten.
- Given I started my draft on commit X and the page changed on the default branch since, When I publish, Then I am shown a three-way view of my change, theirs and the base, and nothing is written until I resolve it.
- Given the page did not change, When I publish, Then the write is queued and its status is shown (`queued`, `pr-opened`, `merged`).
- Given the writer's rebase fails on a conflict, Then my draft is kept and I am told which lines conflict.

### COL-US-35 Ask a named person to approve (COL-35, S)
As a `manager`, I want a standard to be published only after a named reviewer agrees, so that review is visible.
- Given a change to a page goes through a pull request, When I open the page in the portal, Then I see the pull request's state (open, merged, closed) and its link, from the document write record.
- Given the pull request is merged, Then the page shows the new version and the write moves to `merged`.
- Given the pull request is closed without merging, Then the page keeps its previous text and the author is notified.

### COL-US-36 Who last changed it (COL-36, S)
As a `viewer`, I want to see who changed a rule and when, so that I know whom to ask.
- Given a page in the document repo, When I open it, Then it shows the last change's author, date and subject line from Git.
- Given a page was just added, Then it shows the commit that added it.

## Audit

### COL-US-37 Account for permission changes (COL-37, M)
As an `admin`, I want an audit entry for every space grant and restriction change, so that I can answer who changed access and when.
- Given a grant or a restriction is set, cleared or revoked, Then exactly one audit entry (`wiki.space.grant`, `wiki.space.revoke`, `wiki.restriction.set`, `wiki.restriction.clear`) is appended with the actor, project and subject, and never the text of any page.
- Given the audit log is listed by action, Then the new actions appear in the filter list.
- Given I try to change or delete an audit entry, Then the database refuses (append-only).

### COL-US-38 Account for reads of restricted pages (COL-38, S; applies only if COL-27 is built)
As an `admin`, I want each read of a restricted page recorded, so that I can show who saw it.
- Given a restricted page exists, When a listed user reads it, Then an entry is written before the content is returned.
- Given an ordinary page, When a member reads it, Then no audit entry is written (decided: view counts are telemetry).

## Coverage

Every Must and Should row of the matrix has a story: M rows COL-01, 02, 08, 10, 13, 15, 18, 22, 23, 25, 28, 34, 37 and S rows COL-03, 04, 07, 09, 14, 17, 19, 24, 27, 29, 31, 33, 35, 36, 38. COL-US-10 covers COL-10 and COL-18 together.

Negative criteria (access denied, hidden or refused) appear in COL-US-01, 04, 07, 08, 10, 13, 15, 19, 22, 23, 24, 25, 27 and 28.
