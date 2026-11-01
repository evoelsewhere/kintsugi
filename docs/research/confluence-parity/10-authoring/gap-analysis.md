# Authoring and structure: gap analysis

> Research page. The distance between the authoring features of `feature-matrix.md` and what Kintsugi has today: the document repository, the `documents` and `document-writes` modules, the worker's writer, the portal and the Brain. Every code claim was checked against the files named; paths are relative to the repository root. Sizes are rough: **S** a few days, **M** one to two weeks, **L** more, for one engineer who knows the code.

## What exists

| Building block | Where | What it gives the wiki |
|---|---|---|
| Document repo as Markdown with front matter, tables and cards | [Document formats](../../../reference/document-formats.md), [document repo](../../../reference/document-repo.md) | The page format, the numbered layout, one repository per project |
| Read API | `apps/api/src/modules/delivery/documents/interface/documents.controller.ts:35-54` (`documents/refs`, `documents/tree`, `documents/file`) | The tree of a directory and a text file at a ref, up to 2 MiB (`apps/api/src/modules/delivery/documents/domain/document.ts:90`); a binary answers 415 |
| Write path | [Write path](../../../reference/document-repo-write-path.md); `apps/api/src/modules/admin/document-writes/` ; `services/orchestrator/src/document-write/writer.ts` | One write per repository at a time, validation, commit to the default branch for auto-commit paths or a `kintsugi/*` branch with a pull request, fast-forward push with retry, watch of the review |
| Optimistic concurrency | `packages/git/src/write.ts:50-52,150` (`expectedHash`, SHA-256 of the file the person edited) | A conflict is detected before a commit |
| Correction endpoint | `apps/api/src/modules/admin/document-writes/application/document-writes.service.ts:62-92` (`proposeCorrection`) | A person's edited Markdown, with its previous hash, goes to a pull request; used only for gap answers (`documents.resolve`) |
| Binary-capable writer | `services/orchestrator/src/queues.ts:83-91` (`encoding: "base64"`), `packages/git/src/write.ts:50` (`content: string \| Uint8Array`) | Binaries can be committed, but only the worker's own job outputs use it |
| Editor component | `apps/portal/src/components/code/code-editor.tsx:48` (CodeMirror 6, Markdown mode, editable when given `onChange`) | A source editor; today no page edits a project document |
| Markdown view | `apps/portal/src/components/results/markdown.tsx` (GFM tables, Mermaid fences as diagrams, relative links followed in the portal, raw HTML dropped) and `file-browser.tsx` (Preview/Raw) | Reading, diagrams, links |
| Link resolution | `apps/portal/src/lib/document-links.ts:41` (`resolveDocumentLink`), `components/results/document-links.tsx` | A relative link opens in a drawer at the same commit; links that leave the repo or reach `restricted/` are blocked |
| The Brain | [Brain](../../../reference/brain.md); `packages/domain/src/brain.ts` (sections by heading, GitHub-style anchors at line 238, reference ids at line 181, links both ways); portal `apps/portal/src/pages/brain/brain-node-view.tsx:248-273` ("Links to" and what links to a node) | A tree of pages with summaries and citations, backlinks, `brain_changes`; the read side of the wiki |
| Paths in one place | `packages/domain/src/document-layout.ts`; [layout ADR](../../../decisions/0051-document-repo-layout-legacy-and-modern.md) | Where a space can live |
| Stable ids | [ADR-0075](../../../decisions/0075-compact-stable-document-reference-ids.md), `isBrainReferenceId` | The id family a page id can join |

## Gaps in clusters

| Cluster | The gap | Constraint it meets | Size |
|---|---|---|---|
| G1 Write contract | A file entry is `path`, `content`, `createOnly`, `expectedHash`: no delete, no rename, text only on the API (`document-write.ts:50`), `.md` only on the correction endpoint (`document-writes.service.ts:71`), 500 files and 5 MiB per file per write; the low-level `FileWrite` also has no delete or rename (`packages/git/src/write.ts:46-53`) | ADR-0019, Q8 | M |
| G2 Draft store | Nothing is kept before a write is queued; no drafts list, no merge of a moved base | ADR-0010 (Postgres is the only datastore), Q1 decided | M |
| G3 Page identity and links | A page's identity is its path; no `id` in front matter, no rewrite of inbound links on move, no link check | ADR-0042, ADR-0075, Q5 decided | L |
| G4 Page UI | No create, edit, move, copy, delete or restore in the portal; the tree shows files, not titles; no editor over a project document | none | L |
| G5 Rendering | Headings have no id, code has no colours, no alerts, no `kintsugi-*` blocks, images do not resolve, raw HTML dropped | Q4 decided, Q12 open | M |
| G6 Attachments | No raw route for a binary (the file route answers 415), no allowlist, no attachment list, no quota for draft files | ADR-0042 amendment, Q3 decided, Q9 open | L |
| G7 Spaces and order | No space concept, no `20-spaces/` root, no `space.md` or README front matter, no order for siblings | ADR-0028, ADR-0051, Q6 decided, Q10 open | M |
| G8 Publish policy | No `directPublishPaths` key, no `wiki.publish` permission, no "pending review" state in the page view | ADR-0007, ADR-0008, Q2 decided, Q11 open | M |
| G9 Export and import | Print stylesheet, a Markdown export of a page or a folder, Word and Markdown/HTML import | ADR-0010 for a server converter, Q7 decided | M (L with server PDF) |

## Per feature

`none` means nothing to add. The ADR column names the accepted decision the feature meets, or the question that carries it.

| ID | Exists | Missing | Constraint | Size |
|---|---|---|---|---|
| AUT-01 | Starter structure of *Publish kintsugi.yaml* ([document repo](../../../reference/document-repo.md)) | A space: `20-spaces/<space>/README.md` with `space`, `title`, `key`; a create flow | ADR-0028, ADR-0051, Q6 | M |
| AUT-02 | Path addressing `documents/file?path=` (`documents.controller.ts:49`) | A key and a page-id address that survives a move | Q5, Q6 | S |
| AUT-03 | README as folder summary in the Brain (ADR-0091, decision 2) | A landing view per space and per folder | Q6 | S |
| AUT-04 | `file-browser.tsx`, `file-tree.tsx`, `documents/tree` | A tree of titles (front matter or first heading), per space, with the open page highlighted, over project documents | none | M |
| AUT-05 | Name order | An order list (Q10 default: `order:` in the folder README), the Brain builder reading it, a drag UI | Q10, ADR-0091 | M |
| AUT-06 | Project list | A list of spaces: system spaces and `20-spaces/*` of the project | Q6 | S |
| AUT-07 | none | A status in the space README and a filter | Q6 | S |
| AUT-08 | none | A settings view over the space README | Q6 | S |
| AUT-09 | none | none (Won't) | none | none |
| AUT-10 | Brain exclusions (ADR-0091, decision 5) | A `hidden: true` front-matter field read by tree and Brain | ADR-0091 | S |
| AUT-11 | `document-write` jobs create files | A create-page form, slug rule, id allocation, the draft, publish as `page` write | Q1, Q5 | M |
| AUT-12 | `proposeCorrection` with `expectedHash`; `CodeEditor` | An edit page over any allowed Markdown, drafts, 3-way merge, a `page` write kind, a permission | ADR-0019, Q1, Q11 | L |
| AUT-13 | none | A rename write: file rename, title change, inbound link rewrite | Q5, Q8 | M |
| AUT-14 | none | A move write over a subtree (many files, 500-file cap), link rewrite, refusal over the cap with the count | Q5, Q8 | L |
| AUT-15 | none | A copy write with new ids and links inside the copy | Q5, Q8 | M |
| AUT-16 | none | A delete operation, a dialog that lists children and inbound links from the Brain | Q8 | M |
| AUT-17 | Git keeps the file | A deleted-pages view from history (`git log --diff-filter=D`), restore as a write | Q8 | M |
| AUT-18 | none | A status field and a default filter in tree, search and Brain | ADR-0091 | S |
| AUT-19 | Brain `changed` per document; commit trailers ([commit conventions](../../../reference/document-repo-commit-conventions.md)) | A page information panel (author, dates, status, id, space) | none | S |
| AUT-20 | `code-editor.tsx` (Markdown mode); Preview/Raw toggle | A live preview beside the editor, one component for edit and read | Q4 | M |
| AUT-21 | none | A rich-text mode with a byte-for-byte round-trip test over the starter template and a sample repo | Q4 | L |
| AUT-22 | none | An insert menu in the source editor | Q4 | S |
| AUT-23 | none | none in the source editor | none | none |
| AUT-24 | GFM tables render (`markdown.tsx:17`) | A table helper in the editor | none | S |
| AUT-25 | Fenced code renders (`markdown.tsx:33-38`); the code view highlights some languages | Highlighting in the Markdown view | none | S |
| AUT-26 | Mermaid fences render (`markdown.tsx:34`) | An error message in the preview when a diagram does not parse | none | S |
| AUT-27 | none | none (Won't) | none | none |
| AUT-28 | Section anchors in the Brain (`brain.ts:238`) | Heading ids in the portal view from the same function; a table of contents source | Q12, ADR-0091 | S |
| AUT-29 | none | none (Won't) | none | none |
| AUT-30 | none | An emoji and status syntax if wanted | Q4 | S |
| AUT-31 | none | `delivery.wiki_draft`, autosave endpoint, debounce in the editor | Q1, ADR-0010 | M |
| AUT-32 | none | A drafts list per user | Q1 | S |
| AUT-33 | PR flow and auto-commit paths | `directPublishPaths`, `wiki.publish`, pending-review state from `workflow.document_write`, the Brain showing a page after merge | Q2, ADR-0008 | M |
| AUT-34 | `expectedHash` | A 3-way merge in the API; the editor's conflict view with the three texts | Q1 | M |
| AUT-35 | none | none (Won't) | none | none |
| AUT-36 | Write message and PR title | A publish dialog that sets the message | none | S |
| AUT-37 | Raw HTML dropped (`markdown.tsx:62`) | A renderer for GitHub alerts and a toolbar button | Q4 | S |
| AUT-38 | Brain sections | A `kintsugi-toc` renderer | Q4 | S |
| AUT-39 | none | A collapsible block syntax (HTML `details` is dropped) | Q4 | S |
| AUT-40 | none | An include syntax and a rule for the Brain (index the source page only, record the include as a link) | Q4, ADR-0091 | L |
| AUT-41 | Brain children with summaries | A `kintsugi-children` renderer (stored as the macro only) | Q4 | M |
| AUT-42 | Front matter readers (`reverse_engineering/hooks/reader/document.ts`) | A `kintsugi-properties` report over front matter | Q4 | M |
| AUT-43 | Plugins ([ADR-0015](../../../decisions/0015-member-assets-as-agent-plugins.md)) | none (Won't) | none | none |
| AUT-44 | Binary-capable writer (`queues.ts:83`) | A binary field on the API write type, upload endpoint, allowlist, quota, `_attachments/` rule, the ADR-0042 amendment | ADR-0042, Q3, Q9 | L |
| AUT-45 | Mermaid; relative links | A raw route (fixed content type, `Content-Disposition`, `nosniff`, content security policy), an image renderer that resolves `_attachments/` | Q3 | M |
| AUT-46 | none | An attachment list per page, replace and remove writes | Q3, Q8 | M |
| AUT-47 | none | A viewer for PDF in the portal | Q3 | S |
| AUT-48 | Write limits (500 files, 5 MiB, 50 MiB); file API 2 MiB | A visible limit in the upload dialog | none | S |
| AUT-49 | `resolveDocumentLink` | A page picker by title and `[[` autocomplete inserting a relative link | Q5 | M |
| AUT-50 | Anchors in links | Heading ids (AUT-28) | Q12 | S |
| AUT-51 | none | Links to `_attachments/` resolved by the raw route | Q3 | S |
| AUT-52 | `knowledge.brain_link`, the Brain node view's links | The same panel on a page of the wiki | none | S |
| AUT-53 | Brain drops links it cannot follow (`brain.md:19`) | A list of dropped links per document, shown as broken links | ADR-0091 | M |
| AUT-54 | ADR-0075 for cards | Page ids, inbound-link rewrite in the same write, a scan of the mirror to confirm | Q5, Q8 | L |
| AUT-55 | none | A print stylesheet for the page view | Q7 | S |
| AUT-56 | none | Deferred with server PDF | Q7 | L |
| AUT-57 | Clone of the repository | An archive of a folder at a commit | Q7 | S |
| AUT-58 | `GET documents/file` | A "download Markdown" action | none | S |
| AUT-59 | none | A `.docx` to Markdown converter (new dependency) | ADR-0010, Q7 | L |
| AUT-60 | A committed Markdown file is a page | An import dialog that places a file under a space and assigns an id | Q5 | M |
| AUT-61 | none | A zip or folder import over the 500-file cap | Q8 | M |

## What the order of work looks like

The clusters depend on one another in this order. It is a proposal for the roadmap, which the product owner owns.

1. **G1 and G2** first: nothing is editable without the write operations and the draft store.
2. **G5** with Q12: readable pages (heading ids, alerts, code colours) cost little and every later view uses them.
3. **G7** and **G4**: spaces, the tree of titles, create, edit and publish.
4. **G3** with G1: move, rename and delete with link repair.
5. **G6**: attachments, after the ADR-0042 amendment.
6. **G9**: Markdown export and print first; Word import and server PDF last.
