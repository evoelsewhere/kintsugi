# Authoring and structure: open questions

> Research page. Every question about authoring and structure that touches an accepted decision (Markdown only, [ADR-0042](../../../decisions/0042-markdown-only-document-repo-by-bounded-context.md); Git as the source of truth, [ADR-0007](../../../decisions/0007-git-as-source-of-truth.md) and [ADR-0028](../../../decisions/0028-remove-rulebook-single-document-repo.md); Postgres as the only datastore, [ADR-0010](../../../decisions/0010-postgres-only.md)). A business analyst raises them; the architects decide. The features are in `feature-matrix.md`.

## How it works

Each question has its options, the analyst's default and the decision with the board thread post it came from. Q1 to Q7 were put to the architects in the thread `authoring-constraints` and decided at 23:37 by the solution architect for the platform, consistent with the answer of the solution architect for the Brain at 23:36. Q8 to Q12 came out of the user stories and are in the thread `authoring-followups`; the platform architect decided all five at 23:45, on the Brain architect's answer. The stories reference a question as `(Q#)` where a criterion depends on it.

| Id | Question | Features it touches | ADR it meets | Status |
|---|---|---|---|---|
| Q1 | Where does an edit live between keystrokes and publication? | AUT-31, AUT-32, AUT-33 | ADR-0007, ADR-0010 | decided |
| Q2 | How does a published page reach the default branch? | AUT-33, AUT-36 | ADR-0007 | decided |
| Q3 | Where do images and attachments live? | AUT-44 to AUT-48, AUT-51 | ADR-0042 | decided (needs an amendment of ADR-0042) |
| Q4 | Which editor, and how are macros written in Markdown? | AUT-20 to AUT-25, AUT-37 to AUT-42 | ADR-0042 | decided |
| Q5 | How does a page keep its identity when it moves or is renamed? | AUT-13, AUT-14, AUT-49, AUT-50, AUT-53, AUT-54 | ADR-0042, ADR-0075 | decided |
| Q6 | What is a space? | AUT-01 to AUT-10 | ADR-0028, ADR-0051 | decided |
| Q7 | How are pages exported as PDF or Word? | AUT-55 to AUT-57 | ADR-0010 (new dependency) | decided |
| Q8 | Do move, rename and delete need operations in the write contract? | AUT-13 to AUT-16, AUT-54 | ADR-0019 | decided |
| Q9 | Where is an image kept before its draft is published? | AUT-44, AUT-45 | ADR-0010, ADR-0042 | decided |
| Q10 | How is the order of sibling pages stored? | AUT-05 | ADR-0042 | decided |
| Q11 | Which documents may the wiki edit? | AUT-12, AUT-33 | ADR-0019 | decided |
| Q12 | Do the Brain and the portal use the same heading anchors? | AUT-28, AUT-50 | ADR-0091 | decided |

## Decided

### Q1: Where does an edit live between keystrokes and publication?

- **Options:** (a) a Postgres draft per user and page with autosave, publish is one document-write; (b) a draft branch in Git, every save a commit; (c) the browser only.
- **Decision (a).** A draft table holds the full Markdown, the base commit and the hash of the file at that commit. Autosave goes to Postgres only and never through the writer queue, because the writer takes one write per repository at a time. Publish is one document-write with the draft's base hash as `expectedHash`; when the base moved the API merges base, draft and head in three ways, a clean merge publishes and a conflict returns the three texts to the editor. (b) was refused because a commit per save floods history and the writer queue; (c) because work is lost across devices and nobody can see that a page is being edited.
- **Source:** thread `authoring-constraints`, posts of 23:36 (Brain) and 23:37 (platform).

### Q2: How does a published page reach the default branch?

- **Options:** (a) the pull-request flow; (b) a direct commit for configured wiki paths; (c) a choice per space.
- **Decision (c), by path.** Review by pull request is the default. A direct publish needs a path in a new `kintsugi.yaml` key `directPublishPaths` and the new permission `wiki.publish`. A page cannot grant itself direct publish through its own front matter. Until the pull request is merged the portal shows the page as pending review, and the Brain shows it only after the merge.
- **Source:** same thread, both posts.

### Q3: Where do images and attachments live?

- **Options:** (a) beside the page in the repository; (b) Postgres or object storage; (c) only text images (Mermaid, SVG).
- **Decision (a).** Files go under `<page folder>/_attachments/`, with an allowlist of media types (png, jpg, gif, webp, pdf; svg only sanitized or as a download), 5 MiB per file and 50 MiB per write. This amends ADR-0042's "Markdown only" and the amendment is written in ADR-0096. The writer already carries binaries; serving needs a new raw route with a fixed content type, `Content-Disposition`, `nosniff` and a content security policy, because the file route answers 415 for a binary. No object storage and no Git LFS. The Brain does not index binaries and keeps an `attachment` reference (name, size, type) on the page node.
- **Source:** same thread, both posts.

### Q4: Which editor, and how are macros written in Markdown?

- **Options:** (a) Markdown source with a live preview; (b) a rich-text editor that round-trips to Markdown; (c) both. Macro syntax: fenced directives, HTML comments or front matter.
- **Decision (a) first, (b) later.** Phase 1 is the Markdown source editor that the portal already has (CodeMirror) with a live preview. A rich-text mode comes only when it round-trips every document of the starter template and a sample repository byte for byte; otherwise it would rewrite people's files. Panels are GitHub alerts (`> [!NOTE]`, `[!WARNING]`); dynamic and data macros are fenced blocks whose info string is `kintsugi-<macro>` with YAML parameters (`kintsugi-children`, `kintsugi-toc`, `kintsugi-labels`). They are stored as the macro, never as its rendered output, and rendered in the portal. No raw HTML.
- **Source:** same thread, platform post (it changed the analyst's default of `:::` directives, which are not CommonMark and show as stray text on Git servers).

### Q5: How does a page keep its identity when it moves?

- **Options:** (a) a stable id in front matter with a link form `[[id]]`; (b) rewrite relative links on move; (c) accept broken links.
- **Decision: front matter id plus rewritten links.** A page has `id: PAGE-<KEY>-0001` in its front matter (the Brain already treats such ids as reference ids). Links in the file stay standard relative Markdown links, because Git viewers and the Brain follow only those; `[[` is only an editor autocomplete that inserts a relative link. A move or rename is one write that renames the file and rewrites the inbound links, found from the Brain's links and confirmed by a scan of the mirror. Portal addresses use the id, so an old path still resolves.
- **Source:** same thread, both posts.

### Q6: What is a space?

- **Options:** (a) a folder in the project's one document repository; (b) a project; (c) a separate repository role.
- **Decision (a).** The numbered roots (`00-project/`, `01-standards/`, `02-architecture/`, `03-transition/`, each application) are *system spaces*; free team spaces live under a new root `20-spaces/<space>/`. A space home is `README.md` with front matter `space`, `title` and `key`; a page with children is a folder with a `README.md`, a leaf is `<slug>.md`. Paths are built only in `packages/domain/src/document-layout.ts`. A space's access policy is not in its front matter: it is `directPublishPaths` plus permissions in Postgres.
- **Source:** same thread, both posts.

### Q7: How are pages exported as PDF or Word?

- **Options:** a converter in the worker image (a headless browser or pandoc) or nothing server-side at first.
- **Decision.** Phase 1 offers Markdown export (a page, or a space as an archive of its folder at a commit) and the browser's print-to-PDF with a print stylesheet. Server-side PDF and Word need a new dependency in the worker image and an ADR of their own, so they are deferred.
- **Source:** same thread, both posts.

## Decided in the follow-up thread

These are in the thread `authoring-followups`. The solution architect for the Brain answered at 23:44 and the owner, the solution architect for the platform, decided at 23:45: the Brain architect's answer on all five, which the notes below state. Edge cases the decision leaves to ADR-0098 are in the concern post of 23:47 (a second publish while a pull request is open, a move against open page writes, the 500-file cap on a subtree move, one `headingSlug`).

### Q8: Do move, rename and delete need operations in the write contract?

- **Facts:** a file entry of a write carries `path`, `content`, `createOnly` and `expectedHash` and no operation (`apps/api/src/modules/admin/document-writes/domain/document-write.ts:50`); the low-level `FileWrite` has none either (`packages/git/src/write.ts:46-53`); a write holds at most 500 files, 5 MiB per file and 50 MiB per write ([write path](../../../reference/document-repo-write-path.md), step 2).
- **Options:** (a) add an operation per file (`write`, `delete`, `rename from`), keep the 500-file cap and refuse a move over it with the count; (b) express a move as two writes; (c) leave move and delete to Git.
- **Decision (Brain answer, adopted):** (a), recorded in ADR-0098; a move larger than the cap is refused with the count. Each entry keeps `expectedHash`, so a delete or rename of a file someone changed meanwhile fails like a write. One commit per move, so Git sees the rename and `brain_changes` reports `renamed`.

### Q9: Where is an image kept before its draft is published?

- **Facts:** drafts are in Postgres (Q1) and binaries stay out of Postgres (Q3); a pasted image has to be shown before there is a commit.
- **Options:** (a) bounded binary rows in the draft table until publish; (b) refuse the paste until the page exists in Git; (c) commit the image alone first.
- **Decision (Brain answer, adopted):** (a), as a bounded Postgres exception: a draft-attachment table with the same allowlist, 5 MiB per file and 20 MiB per draft, deleted with the draft or when its publish write is committed, never served outside the draft's editor and never indexed.

### Q10: How is the order of sibling pages stored?

- **Facts:** Q6 puts the order in front matter; reordering one page would then change every sibling.
- **Options:** (a) `order` per page with gaps; (b) one `order:` list in the folder's `README.md`; (c) numeric file-name prefixes.
- **Decision (Brain answer, adopted):** (b). The list holds entry names of that folder (`deploy.md`, `runbooks`); listed entries come first in list order, folders and documents mixed, then the unlisted ones as today (folders, then documents, by name); unknown names are ignored; a folder without a README has no manual order. A move or rename rewrites the old and the new parent's list in the same write. The Brain builder reads it ([ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md), amended in ADR-0097); no existing repository has `order:`, so nothing changes for them.

### Q11: Which documents may the wiki edit?

- **Facts:** many documents are written by jobs (`_generated/`, the specification and rules of a unit, the design sets); today a person edits one only through a gap answer.
- **Options:** (a) any Markdown except `_generated/` and `restricted/`, job-written documents always by pull request; (b) only `20-spaces/`; (c) everything.
- **Decision (Brain answer, adopted):** (a) with more exclusions. Never editable in the wiki: `_generated/`, `restricted/`, `plugins/`, `scratch/`, hidden folders and the identifier ledgers `identifiers/` (a hand edit breaks the allocation of [ADR-0075](../../../decisions/0075-compact-stable-document-reference-ids.md)). Job-written documents (`01-legacy/<module>/<unit>/*`, design sets, unit cards) show a banner and always go by pull request. The list lives in `packages/domain/src/document-layout.ts` next to `isBrainIndexedPath` so that the two never drift.

### Q12: Do the Brain and the portal use the same heading anchors?

- **Facts:** the Brain gives a section the GitHub-style anchor of its heading, `brainAnchor` (`packages/domain/src/brain.ts:239`); the portal renders headings without an id (`apps/portal/src/components/results/markdown.tsx:13-16`).
- **Options:** (a) one slug function in `packages/domain` used by the Brain builder, the portal renderer and the link checker; (b) two functions kept in step by a test.
- **Decision (Brain answer, adopted):** (a). The function exists; it is exported once as `headingSlug` and the portal and the link checker import it. Duplicates are numbered by the Brain builder as GitHub does.
