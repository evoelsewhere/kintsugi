# Wiki change notifications

> How people are told about the wiki: the `wiki-notify` job of the worker that tells the watchers of a page, a folder or a space that it changed (its cursor, its sweep, who is told and who is not, how long it takes), the notifications a comment makes, and the inbox that shows them ([ADR-0099](../decisions/0099-wiki-collaboration-and-access.md) decision 3, with its amendment on how the job is requested). The comments themselves are in [Wiki comments](wiki-comments.md).

A person **watches** a page, a folder or a space of a project (`knowledge.wiki_watch`; at most 500 watches a person and project). The routes `GET`, `PUT` and `DELETE /api/projects/:id/wiki/watches` are the caller's own and need only Project Access: `PUT` takes `{ scopeKind: page | folder | space, target }` (a page is stored by its id when it has one, so a move keeps the watch; a folder or a space the Brain does not know is refused), and `GET ?path=` says whether a page is watched, directly or through a folder or a space. When the default branch of the document repository moves, the worker tells the watchers what changed, by one notification per person and page (`core.notification`, kind `wiki-page-changed`). A notification holds **ids only**: `{ pageKey, commit, actorId }`, where `pageKey` is the page's id (`PAGE-…`) or `path:<path>` for a page that has none. It never holds a title, a path or any text of the page; whoever reads the notification looks the names up then, and only for a person who still has Project Access.

## When it runs

The worker, not the build, makes these notifications, and the job is **requested after the build, from a cursor that a sweep replays** ([ADR-0097](../decisions/0097-brain-indexes-wiki-pages.md) and ADR-0099 each carry an amendment saying so). A failing fan-out therefore never fails or rolls back a build, and a run that stopped halfway is repeated without a second notification.

1. The worker builds the Brain of a wiki project after the default branch moved ([Brain](brain.md)). When the build is stored, it asks for the job `wiki-notify` (`{ projectId, from, to }`, one running and one queued per project). The request is made after the build and outside it: if it cannot be made, the build is still `built`.
2. The job starts from the **cursor** of the project (`knowledge.wiki_notify_cursor`), the last commit the watchers were told about, up to `to`. It moves the cursor only after it made the notifications, so a run that failed halfway is repeated from the same commit and the notifications it made are not made twice (the unique `dedupe_key` is `wiki-page-changed:<person>:<page key>:<commit>`).
3. The worker's Brain check, which already runs every minute, asks again for every wiki project whose indexed commit is not the cursor. That finds a request that was lost, and it is also the first run of a project.

The **first run** of a project only sets the cursor to the indexed commit and tells nobody, so switching a wiki on does not announce its whole history. A cursor that is not behind `to` (the branch was rewritten) is set to `to` without telling anybody; a request older than the cursor does nothing.

## Who is told

For each page that was added, edited, deleted or renamed between the cursor and `to` (a Markdown file the wiki may write, [`isWikiEditablePath`](wiki-editing.md#what-is-never-editable)), the job tells every person who

- watches the page (by its id, or by its path when it had no id), a folder above it or its space, in the old place too after a rename;
- still has Project Access on the project and an enabled account (the same grant the API checks, `admin.project_access`);
- did not make the change: the people behind the commits that touched the page are known by the `Kintsugi-Actor` trailer, by the author's e-mail address (a commit pushed from a member's own clone) and by the actor of the document write the commit belongs to.

A person who watches the same page twice, through a folder and the space, is told once. At most **200 pages** are told per run; the others are left out and the run logs how many.

## How long it takes

Measured with the real worker and a real git remote (`services/orchestrator/test/wiki-notify-latency.test.ts`, review watch and Brain check every second): the notification exists about **3 seconds** after the review watch records that the pull request was merged (a build of one changed page, then the job). With the default intervals the merge is found by the review watch within a minute of the merge, which brings the sum under two minutes; a change pushed straight to the branch from a clone is found by the Git poll (`KINTSUGI_GIT_POLL_INTERVAL`, 180 seconds by default). Neither interval belongs to the job; lower them to shorten the wait.

## Comments and mentions

A comment makes its own notifications when it is saved, not through the job, and they hold ids only like every other: `{ pageKey, commentId, actorId }`.

| Kind | Who gets it |
| --- | --- |
| `wiki-mention` | a person the comment mentions with `@username` and who has Project Access |
| `wiki-comment` | the author of the comment this one answers, and everyone who watches the page (by its id, or `path:<path>`), a folder above it or its space |

A person is told once per comment, by the strongest reason (a mention first); the writer is never told of their own comment; a person who no longer has Project Access is skipped; at most 500 watchers are told. The unique `dedupe_key` is `<kind>:<person>:<comment id>:-`, so a repeated request makes nothing twice. A name that is nobody's, or whose owner has no Project Access, is not found: no notification, and the answer to the writer is the same as without the mention. A failure to write a notification is logged and never loses the comment. **A mention in the body of a page notifies nobody yet**: only a mention in a comment does.

## The inbox

A person reads their own notifications (`core.notification`) through `/api/notifications`, which need a session and show only the projects the person still has Project Access on:

| Route | What it does |
| --- | --- |
| `GET /api/notifications?unread=&limit=&before=` | The newest first, at most 100 at a time (`before` pages back): the kind, the project name, the page's key, path and title, who did it, the comment id for a comment kind, the time and whether it was read; `unread` counts the unread ones. Names and titles are looked up when the list is read, never stored |
| `GET /api/notifications/unread-count` | `{ unread }`, for the number in the side menu |
| `POST /api/notifications/read` | `{ ids: [uuid…] }` or `{ all: true }`; 204 |

Writing a notification also announces it on the change feed: the topic `notifications` with the person's id as scope, and the event stream sends it **only to that person's own streams**, so nobody learns that someone else has a notification. The portal's inbox page and the unread number read again when the topic changes. Mail, chat and webhooks are not part of this.

## Known limits

- While a project's wiki is off the job tells nothing and does not move the cursor, so the first run after the wiki is switched on again tells about the changes made meanwhile (up to 200 pages). A project that never had a cursor starts without telling anybody.
- The author of a change is only known when a commit says so (trailer, e-mail address of an account, or a document write). Another author is told like anybody else.
- A page that changed in many commits between two runs is one notification at the last commit; the notification does not say how many commits.
