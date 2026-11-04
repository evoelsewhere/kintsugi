# Wiki editing

> How a page is written, published, moved and restricted in the portal's wiki, the routes behind it and what is audited ([ADR-0098](../decisions/0098-wiki-page-editing-and-publishing.md), [ADR-0099](../decisions/0099-wiki-collaboration-and-access.md)). Reading is in [Wiki reader](wiki-reader.md).

Git stays the source of truth. A page is a Markdown file of the document repository; the portal keeps only a person's **draft** between keystrokes, and a **publish** is one document write that the worker commits ([document write path](document-repo-write-path.md)). The portal never writes a file itself.

## Who may do what

| Permission | Lets a person |
| --- | --- |
| `wiki.write` | Make a draft of a page, publish it as a pull request, move a page, start a new one |
| `wiki.publish` | Publish straight to the default branch, for the paths set in `directPublishPaths` (needs `wiki.write` too) |
| `wiki.manage` | Switch the wiki on and set or clear edit restrictions |

All of it is on top of Project Access to the project: every route below is under `/api/projects/:id/wiki/` and a person without Project Access gets 403, as for every project route. An **edit restriction** only narrows: a folder or a page that carries one is writable only by the people and roles it lists, a rule of a folder adds to the rules of the folders above it, and `wiki.manage` does not exempt anyone. It is checked by the API when a draft is saved, when it is published, moved or deleted, and a refusal is audited, so a client that skips the portal gets no further. The worker's writer is the last check of the path rules (`isWikiEditablePath`, `directPublishPaths`) and of page ids; it has no access to the restrictions, which live in Postgres.

## The editing flow

| Step | Address in the portal | API |
| --- | --- | --- |
| Ask what the person may do with a page | the Edit, New page and Move buttons are shown or explained from the answer | `GET access?path=` |
| Start a new page in a folder | New page in a folder, with a title and, when the folder has any, a template | `POST pages` `{ folder, title, templatePath? }`, `GET templates?folder=` |
| Edit | `/wiki/<path>.md?project=<id>&view=edit` | `GET draft?path=`, `PUT draft` |
| Own drafts | `/wiki/-/drafts?project=<id>` | `GET drafts` |
| Publish | the Publish dialog of the editor | `POST publish` |
| Move or rename | the Move dialog of a page | `POST move/preview`, `POST move` |
| Delete | the Delete dialog of a page, which first counts the links that will break | `POST delete` |
| Attach a file or an image | the editor's attach button and the image insert | `POST draft/attachments`, `GET draft/attachments`, `DELETE draft/attachments`, `GET draft/attachments/file` |
| Archive, restore, labels | Archive and Restore on a page, the labels of its front matter, `/wiki/-/archived?project=<id>` | the same draft and publish routes: each is an edit of the page's front matter |
| Restrictions | the people and roles an edit is limited to | `GET restrictions?path=`, `PUT restrictions`, `DELETE restrictions` |

**Drafts.** Typing saves the draft in Postgres (autosave); nothing reaches the document repository until the person publishes. The first save names the commit the text was read from (`baseCommit`) and the server stores the hash of the page there, never at the head, so a page that moved since is merged, not overwritten. Later saves name the revision they last saw; a stale one is a 409 `draft-revision` (the same person in two tabs). A draft is at most 5 MiB and belongs to its author; others see only who else touched the page in the last two minutes, never their text.

**A new page.** The address is `<folder>/<title as a slug>.md` (letters folded to `a-z`, at most 60 characters, `-2`, `-3` while a page or a draft of the person has the name). The id is `PAGE-<space key>-<number>` (`DOC` outside a space) from a counter that first catches up with the highest id the Brain knows in that scope. With a template the text is the template with `id:` and `title:` set and `template:` and `type: template` removed, every other byte kept, so a page published unchanged is exactly that text. Templates are the pages whose front matter says `type: template` in the `_templates/` folders on the way up from the folder and in `01-standards/page-templates/`.

**Publish.** `POST publish` answers one of:

| Answer | Meaning |
| --- | --- |
| `unchanged` | The draft is the page as it is at the head: nothing is written |
| `merge-preview` | The page changed since the draft was read, and the three versions merge cleanly. The person sees the merged text and sends the request again to publish it |
| 409 `conflict` | Both sides changed the same lines. The answer carries the base, the draft, the head and the regions; the person resolves them and sends the result |
| 409 `open-write` | Another person's write of the page is waiting for review: names it |
| `published` | One write was made: `mode` is `pull-request` or `direct`, with its branch and pull request |

The writer is the last to check ids: a page whose id another file already holds is refused, and the write fails with "Page id X is already defined by <path>" and commits nothing.

A page has **one open write** at a time; the author of it publishes again onto the same branch, which updates the pull request instead of opening another (`continues`). The merge, with its conflict regions, is the domain's `mergeText`; the same function writes the Git-style markers the conflict screen shows (`mergeWithMarkers`).

**Pull request by default.** A write goes to a `kintsugi/*` branch and a pull request. It goes straight to the default branch only when all of these hold: the person asked for it, has `wiki.publish`, satisfies the `publish` restrictions, and **every** path of the write matches a glob of `directPublishPaths` in `kintsugi.yaml` at the head of the default branch ([manifest](document-repo-manifest.md)). One path outside makes the whole write a pull request. A page write never uses `autoCommitPaths`. Its commits carry `Kintsugi-Actor`, `Kintsugi-Page` and, for a minor edit, `Kintsugi-Minor` ([commit conventions](document-repo-commit-conventions.md)), and when the review watch sees the pull request merged it records the merge commit, so the history of the file can be tied to the write.

**Move and rename.** The preview lists the page and every page whose links change and writes nothing; the move is one write: the page with its own links rewritten for the new folder, and each page that links to it with those links rewritten (the text of a link, its `#heading` and its title are kept; code blocks and inline code are not touched; the `order` lists of the old and the new home page follow). The pages that link to a page are found in the Brain's index and read at the head, so a link added since the last build is rewritten only if the Brain already knew it; a page that has a write of its own waiting is not touched, and more than 500 entries are refused (`too-many`, "Too many pages link here (N, the limit is 500)"). A target that exists is 409 `target-exists`. A move needs `wiki.write` and passes the restrictions on every path it touches, the target included.

**Delete.** `POST delete` `{ path, message }` is one write with a delete entry whose hash is that of the head; it also removes the page's name from the `order:` list of the folder's home page when it is there. It goes by pull request or directly under the rules of a publish, needs `wiki.write` and the edit restrictions of the path, and answers with the number of links into the page (`brokenLinks`): they become broken links, which the [reader](wiki-reader.md#addresses) lists. A page with a write waiting for review is 409 `open-write`.

**Attachments.** A file or an image of a page is kept beside its draft, at most 5 MiB a file and 20 MiB a draft, of type png, jpg, jpeg, gif, webp or pdf (SVG is refused), with its content checked against the type it claims and its name made safe and unique. It is published in the same write as the page, under the `_attachments/` folder beside it (as bytes, unchanged), and removed with the draft once the write is committed or merged. Only its author sees it before that. The raw route that serves attachments sends a fixed content type, a `nosniff` header and `default-src 'none'; sandbox`, so a file is never rendered as a page ([document read path](document-repo-read-path.md)).

**Archive and labels.** A page is archived by `status: archived` in its front matter and restored by removing that line; its labels are the `labels:` list. Both are edits like any other, so they are drafts, publishes and pull requests, and the reader and the Brain take them from the text once the build has run.

## What is never editable

The wiki writes Markdown pages and, in a page's `_attachments/` folder, files of type png, jpg, jpeg, gif, webp and pdf. It never writes `kintsugi.yaml`, `_generated/`, `restricted/`, `plugins/`, `scratch/`, `identifiers/`, a hidden folder, any other type of file, or a document a stage writes (`10-applications/<app>/01-legacy/` and `02-modern/`): those change through pull requests of the stages. The rule is one function, `isWikiEditablePath`, which the API and the writer both use.

## What is audited

| Action | When |
| --- | --- |
| `wiki-page.publish` | A page was published (path, mode, write, page id) |
| `wiki-page.move` | A page was moved (from, to, mode, write, number of pages and links rewritten) |
| `wiki-page.refused` | A save, a publish or a move was refused for a missing permission or a restriction, with the path, the reason and what was being done; a path that is not editable is a 400 and is not audited |
| `wiki-restriction.set`, `wiki-restriction.clear` | A restriction was set or cleared |
| `wiki.switch` | The wiki was switched on or off ([Brain](brain.md#the-wiki-switch)) |

## Limits

- Backlinks and the pages a move rewrites come from the Brain's index, so they are as new as its last build; the moved page's own links and every page read for the plan are read at the head.
- A write that only rewrites the links of a page is not seen as an open write of that page; two such writes meet at the merge of their pull requests.
- The Brain reads a link inside inline code or a code block as a link, and a move leaves it alone, so it shows as broken after the move.
