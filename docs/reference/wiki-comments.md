# Wiki comments

> What a comment on a wiki page is, how it stays on its passage while the page changes, who is told about it, the routes and the rules for resolving, editing and deleting ([ADR-0099](../decisions/0099-wiki-collaboration-and-access.md) decisions 1, 2, 5 and 7). Telling people about a comment is part of [Wiki change notifications](wiki-notifications.md#comments-and-mentions).

## What a comment is

A comment is a **row in Postgres** (`knowledge.wiki_comment`). It is never written to Git, so it needs no pull request and does not enter the history of the page, and it is never part of the Brain: `brain_read` does not return it. It belongs to a project and a page, by the page id (`PAGE-…`) or, for a page that has none, by `path:<path>`, so a move of the page keeps its comments. The text is Markdown, at most 8,000 characters; the portal shows it through the reader's renderer (no raw HTML, no remote image).

A comment is on **the page as a whole** or on **a passage**. An answer is a comment with a parent; answers go one level deep (an answer to an answer is refused, and so is an anchor on an answer). A page has at most **200 open comments**; the 201st is a 409 with `details.code` `too-many`. A resolved comment is not counted.

## The anchor and the three places a comment can be

A comment on a passage keeps the **plain text a reader sees** (`exact`, at most 500 characters), up to 64 characters before and after it, the section it was written in (`node`: the anchor of a heading or the id of a card; the page path for text before the first heading) and the commit the Brain had indexed. The quote is taken from a selection in the rendered page, so it is plain text, in **one block** (a paragraph, a list item or a table cell): a selection that spans blocks is refused in the portal. The server checks the quote against the page as the Brain indexed it and refuses a quote that is not there (400).

When the comments are read, each one is placed again at the commit the Brain has indexed:

| `status` | Meaning | `node` and `line` |
| --- | --- | --- |
| `anchored` | The quote is still in the section it was written in. A comment on the whole page is always anchored | the section and the line of the quote |
| `moved` | The quote is in the page, under another heading now | the new section and line |
| `orphaned` | The quote is gone | the old section, no line; the comment is listed at the end of the page with its quote, never lost |

Nothing is fuzzy: the quote is there or it is not. The placement is worked out when the comments are read and never stored, so it follows the page without a write. A comment on a passage needs the Brain: while it is not built the route answers 409.

## Mentions

`@username` in a comment names a person. When the comment is saved the names are looked up among the people **with Project Access** on the project. A name that is nobody's, or whose owner has no Project Access, is not found and nothing is said: the answer to the writer is the same as for a comment without the mention, so a mention shows neither who exists nor who may read the project. A mention inside inline code or a code fence is not read, and `a@b.c` is an address. The editor suggests names from `GET /api/projects/:id/wiki/people?q=` (at most 20: id, username and display name, never an email address). A mention in the **body of a page** is plain text and notifies nobody yet.

## Who is told

When a comment is saved, the people it concerns each get one notification, the person who wrote it never:

- the people it mentions, `wiki-mention`;
- the author of the comment it answers, and the people who watch the page, a folder above it or its space, `wiki-comment`.

A person who qualifies twice is told once, by the mention. Only people with Project Access are told. A notification that cannot be written is logged and never loses the comment. Details in [Wiki change notifications](wiki-notifications.md#comments-and-mentions).

## Routes

All are under `/api/projects/:id/wiki/comments` and need Project Access on the project (an administrator without it gets 403, as for every project route).

| Route | What it does | Needs |
| --- | --- | --- |
| `GET ?path=&limit=&after=` | The comments of a page in time order, each placed again (`limit` at most 100; `next` is the `after` of the following page). A deleted comment is listed, empty, only while an answer to it is | Project Access |
| `POST` | `{ path, body, anchor?: { node, exact, prefix?, suffix? }, parentId? }` writes a comment or an answer; 201 with the comment. The same text from the same person within five seconds is the same comment (a double click) | `wiki.comment` |
| `PATCH /:commentId` | `{ resolved?, body? }`, at least one: resolve or reopen, or edit the text | `wiki.comment`; the text only by its author |
| `DELETE /:commentId` | 204 | the author, or `wiki.manage` |

Refusals: 400 for an empty or too long text, a quote the page does not hold, an answer to an answer, or a resolve of an answer; 403 without the permission, or for an edit or delete that is not the caller's; 404 for a page the default branch does not have and for a comment that is not there or is deleted; 409 `too-many` (also when a reopen would pass 200) and 409 `has-replies`.

## Resolve, reopen, edit and delete

- **Resolve and reopen**: anyone with `wiki.comment`, on a comment that is not an answer. The mark is on the thread, not on a person.
- **Edit**: only the author, with `wiki.comment`; the text is trimmed, 1 to 8,000 characters, and the comment shows *edited*.
- **Delete by the author**: while nobody has answered. After an answer the author's delete is a 409 `has-replies`.
- **Delete by a moderator**: a person with `wiki.manage` can delete any comment, also one that has answers. The text is removed. A deleted comment that has answers stays in the thread as an empty marker (*This comment was deleted*), so the answers keep their place; one without answers disappears.
- **Audit**: a delete by a moderator is recorded as `wiki-comment.delete` in `governance.audit_event` with the page path, the comment id and the author's id, never the text. An author's delete of their own comment is not audited.

## What the portal shows

The comments panel beside a page lists the open count, each comment with its answers and a box for a comment on the page. When a passage of the page is selected, a button writes a comment on it, and a comment whose passage is still in the page is marked on the page. Orphaned comments are listed apart with their quote. Under each comment the panel offers only what the caller may do (resolve or reopen, edit, delete); the API decides in the end. Nothing of a comment is stored in the browser.

## What members' agents read

An agent of a member reads the comments of a page with `GET /api/member/v1/comments?projectId&path&status`, the tool `comments_list` and the command `kintsugi comments <path>`: the open threads by default, every comment with `status=all`, in time order, at most the first 500 (`truncated` says there are more). A comment is project data that is open to a member of the project by default, and it is never part of a Brain answer: `brain_read` and the other Brain tools do not carry it. The shapes and the guards are in [member client compatibility](member-client-compatibility.md#a-new-read-for-the-comments-of-a-page); the tool is listed in [Member CLI](member-cli.md).

## Not built yet

Reactions, comments on a version of a page and a search over comments are not built.
