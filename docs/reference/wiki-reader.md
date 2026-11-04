# Wiki reader

> What the portal's wiki shows, the addresses it uses, the API routes each view reads and what it never does ([ADR-0096](../decisions/0096-wiki-pages-in-the-document-repo.md), [ADR-0097](../decisions/0097-brain-indexes-wiki-pages.md), [ADR-0099](../decisions/0099-wiki-collaboration-and-access.md)). In Phase 1 the wiki only reads: pages still change through Git.

The wiki is a view of a project's document repository ([layout](document-repo.md), [formats](document-formats.md)) made from the [Brain](brain.md): the page tree is the Brain's tree, search is the Brain's `brain_grep`, and every page's text is read from the commit the Brain indexed, so what a reader sees and what an agent cites are the same lines of the same commit.

## Turning it on

A project's wiki is a switch on its Brain: `PUT /api/projects/:id/wiki` with `{ "enabled": true }` turns the Brain on for the repository's default branch and queues a build, and from then on the Brain follows the default branch. `{ "enabled": false }` clears the switch and leaves the Brain as it is. The switch needs the permission `wiki.manage` on top of Project Access and is audited as `wiki.switch`. The rules, the refusals (409) and their messages are in [Brain → The wiki switch](brain.md#the-wiki-switch). With the switch off the portal shows "The wiki is off" and loads nothing.

## Addresses

Every address carries the project as `?project=<id>`; the rest is the path of a page or folder in the document repository.

| Address | Shows |
| --- | --- |
| `/wiki?project=<id>` | The root of the repository: its top folders and home page |
| `/wiki/<folder>?project=<id>` | A folder: its home page (`README.md` or `index.md`) when it has one, else its entries in the folder's `order` |
| `/wiki/<path>.md?project=<id>` | A page, rendered as it was at the indexed commit |
| `/wiki/<path>.md?project=<id>#<heading>` | The page scrolled to a heading; the heading's address is the one the Brain gives its node (one slug function in `packages/domain`) |
| `…?view=history` | The versions of the page, newest first, following renames |
| `…?version=<sha>` | The page as it was at one commit |
| `…?view=compare&from=<sha>&to=<sha>` | The two versions side by side with the lines added and removed |
| `?q=<words>&space=<KEY>&label=<label>` | Search results in place of the page: the lines that hold every word, each in the page and section that holds it, narrowed to a space and a label |
| `/wiki/-/space/<KEY>?project=<id>` | The home page of a space (its `README.md`), rendered as any page; a space without one lists the pages the Brain knows in it. The key is read in any case |
| `/wiki/-/label/<label>?project=<id>` | The page of a label: every page that carries it, with its folders, space and status. The label is cleaned as the Brain cleans a page's labels (lower case, letters, digits and hyphens) |
| `/wiki/-/recent?project=<id>` | Recent changes: the newest commits that changed pages, with who made them, when, the comment and the pages each touched; fifty at a time, older ones on request |
| `/wiki/-/broken?project=<id>` | The links of indexed pages to Markdown pages the repository does not have |

A page address ends in `.md`; any other path is a folder. The pages under `/wiki/-/` are views of the wiki, never pages of the repository.

A page shows, above its text, its trail, labels (each a link to its label page), status and last change, and a table of contents of its headings when it has three or more; the backlinks panel comes below the text. The table of contents is made from the page's own headings in the browser and reads nothing.

## What each view reads

All routes are under `/api/projects/:id` and need Project Access on the project (a person without it gets 403, as for every project route). Their shapes are in [Brain](brain.md#reads) and the [document read path](document-repo-read-path.md); this table only says which view uses which.

| View | Routes |
| --- | --- |
| Open the wiki | `GET brain` (state, indexed commit, wiki flag) |
| Turn the wiki on (the button of the off screen, for a person with `wiki.manage`) | `PUT wiki` |
| Page tree, folder | `GET brain/tree` |
| Page: labels, status, last change | `GET brain/lookup?q=<path>` |
| Page text, older version, export | `GET documents/file?ref=<commit or sha>&path` |
| Attachments and images | `GET documents/attachment?ref&path` |
| History | `GET documents/history?ref&path&limit&before` |
| Compare | `GET documents/compare?path&from&to` |
| Search | `GET brain/grep?text&space&label` |
| Space home | `GET brain/lookup?q=space:<KEY>`, then the home page as above |
| Backlinks panel of a page | `GET brain/backlinks?node=<path>&offset&limit`, twenty at a time, "Show more" asks for the next window |
| Label page | `GET brain/tree`, folder by folder, keeping the pages whose node carries the label (a lookup of `label:<label>` answers at most 20, so the page does not use it) |
| Recent changes | `GET documents/recent?ref&before` |
| Broken links | `GET brain/broken` |

## What the reader never does

- It writes nothing: no route of the wiki changes a document, and the export saves the text the page shows as the `.md` file it is in the repository.
- It renders no raw HTML in a page: the renderer skips it. Diagrams (Mermaid) run in strict mode, and GitHub alerts and `kintsugi-*` fenced blocks are drawn by the portal, never executed.
- It loads no image from another site: an image on the web is shown as a link, because loading it would tell its host who reads which page. Only image attachments (`png`, `jpg`, `jpeg`, `gif`, `webp`) from an `_attachments/` folder are shown, through the route above with a fixed content type.
- It keeps nothing in the browser: what was asked (the page, the search, the versions) is in the address, and the wiki writes nothing to local storage, session storage or cookies.
- It never shows a page the viewer cannot read: every read goes through Project Access, and a page's own front matter cannot widen it.

## For members' agents

A member's agent finds the same pages through the member API ([compatibility](member-client-compatibility.md)):

- `brain_lookup` with `label:<name>` or `space:<KEY>` (the key in any case) returns the pages that carry the label or are in the space;
- a client that sends `Kintsugi-Member-Features: page-attributes` also gets each node's labels, space, status, owner and template flag; one that does not gets the shape it always had;
- `brain_backlinks` lists the pages that link to a page, a heading or a card, in windows with the total;
- `brain_read` returns the text with numbered lines and a citation, which the agent quotes as `path:first-last@commit`.

## How Phase 1 is checked

The wiki test script of Phase 1 opens a page from the tree, follows a heading link, filters a search by label and space, compares two versions, and has an agent find the same page by `brain_lookup` with a label and cite it as `path:lines@commit`; the [Brain eval](../development/brain-eval.md#phase-1-result) shows no loss against the Phase 0 baseline.
