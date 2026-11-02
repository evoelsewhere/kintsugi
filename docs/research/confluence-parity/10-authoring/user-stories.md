# Authoring and structure: user stories

> Research page. One story for every Must and Should feature of `feature-matrix.md` (and a second for the features that serve two personas), each with one persona, a MoSCoW priority and Given/When/Then criteria a tester can check in the portal or through the member API and the MCP bridge. The criteria respect the decisions the architects took on the constraint questions of [open questions](open-questions.md); a story whose criteria depend on a question still open says `(Q#)`.

## Conventions

- **Id**: `AUT-nn-S<n>`, the feature id and a number.
- **Personas**: *member* (a project member who writes documents and builds), *manager* (a project manager), *admin* (the installation's administrator), *viewer* (a person who only reads), *agent* (a member's agent reading through the [Brain](../../../reference/brain.md) and the member tools).
- **Words used in the criteria**: *space* is a folder of the project's one document repository (system spaces are the numbered roots, team spaces are under `20-spaces/`); *publish* is one document-write, by pull request unless the path is in `directPublishPaths` and the person holds `wiki.publish`; *draft* is the working copy in Postgres; *page id* is the `id` front-matter field `PAGE-<KEY>-0001`.
- Where a criterion names the pull request, the same applies to a direct commit, with the page live at once.

## Spaces and the page tree

### AUT-01-S1: Create a team space
**As a** manager **I want** to create a space with a name, a key and a short purpose **so that** a team has a home for its documents outside the application folders. Priority **M**. Depends on Q6.
- **Given** a project with a document repo, **When** a manager creates the space "Payments guild" with key `PAY`, **Then** a publish adds `20-spaces/pay/README.md` with front matter `space`, `title` and `key`, and the space is listed as *pending review* until the pull request is merged.
- **Given** a space with the key `PAY` exists in the project, **When** a manager submits another space with that key, **Then** the form refuses it and names the existing space.
- **Given** a viewer, **When** they open the list of spaces, **Then** no create action is shown.

### AUT-02-S1: Share a stable address of a page
**As a** viewer **I want** an address of a page that still works after the page is moved **so that** a link I sent last month does not break. Priority **S**. Depends on Q5.
- **Given** a page with id `PAGE-PAY-0007` at `20-spaces/pay/intro.md`, **When** the viewer opens the portal address that holds its id, **Then** the page opens.
- **Given** the page was then moved to `20-spaces/pay/start/intro.md`, **When** the same address is opened, **Then** the page opens at its new path.
- **Given** an id that no page has, **When** its address is opened, **Then** a "no such page" view is shown and the portal does not guess another page.

### AUT-03-S1: Land on the overview of a space
**As a** viewer **I want** a space to open on its overview page **so that** I know what the space is for before I read pages. Priority **S**. Depends on Q6.
- **Given** a space whose `README.md` has a title and a first paragraph, **When** the viewer opens the space, **Then** the overview shows the title, the paragraph and the first level of its pages.
- **Given** a space without a `README.md`, **When** it is opened, **Then** the portal shows its first level of pages and a notice that the space has no overview, with a create action for a member.

### AUT-04-S1: Find a page by title in a tree
**As a** member **I want** the pages of a space as a tree of titles **so that** I find a page without knowing its file name. Priority **M**.
- **Given** a space with a page `intro.md` titled "Getting started" under a folder `guides/` with a `README.md` titled "Guides", **When** a member opens the space, **Then** the tree shows "Guides" with "Getting started" below it, not the file names.
- **Given** a page is open, **When** the tree is shown, **Then** the open page is highlighted and its parents are expanded.
- **Given** a page without a title in its front matter or a first heading, **When** the tree is shown, **Then** it appears under its file name.

### AUT-05-S1: Put pages in a chosen order
**As a** member **I want** to drag a page to a place among its siblings **so that** the reading order is on purpose. Priority **S**. Depends on Q10 (default: one `order:` list in the folder's `README.md`).
- **Given** a folder with three pages in name order, **When** a member drags the third to the top and publishes, **Then** one file changes (the folder's `README.md` with the new list) and the tree shows the new order after the merge.
- **Given** a page not named in the list, **When** the tree is shown, **Then** it comes after the listed pages in name order.

### AUT-06-S1: Find the spaces I may read
**As a** viewer **I want** a list of the spaces of a project **so that** I can see where documents live. Priority **S**. Depends on Q6.
- **Given** a project with the system spaces and one team space, **When** a viewer opens the spaces list, **Then** it shows the numbered roots that exist, each application, and `20-spaces/*`, each with its title and last change.
- **Given** a folder the viewer's project access does not allow, **When** the list is shown, **Then** it is not in the list.

## Page operations

### AUT-11-S1: Create a page without a Git client
**As a** member **I want** to create a page from the portal **so that** I do not clone the repository to add a document. Priority **M**. Depends on Q1, Q5.
- **Given** a member in a space, **When** they choose "New page" under a page and enter the title "Retry policy", **Then** a draft is created with the file `retry-policy.md` next to its siblings, front matter with a new `id` and the title, and the editor opens on it.
- **Given** a title whose slug a sibling already has, **When** the member continues, **Then** the portal proposes a different slug and does not overwrite the sibling.
- **Given** the member publishes, **When** the write ends, **Then** the page is listed as pending review or live, per the path's policy.

### AUT-12-S1: Correct a page in the portal
**As a** member **I want** to edit a page and publish my change **so that** a fix does not need a Git client. Priority **M**. Depends on Q1, Q11.
- **Given** a Markdown page that a person may edit, **When** a member opens it for editing, **Then** the editor shows the source with a preview and the page's base commit is kept with the draft.
- **Given** the member changes a sentence and publishes, **When** the write is queued, **Then** the pull request holds one changed file and its title is the publish message.
- **Given** a document under `_generated/` or `restricted/`, **When** a member opens it, **Then** no edit action is offered.

### AUT-13-S1: Rename a page without losing its links
**As a** member **I want** to change a page's title and file name **so that** the tree stays honest. Priority **M**. Depends on Q5, Q8.
- **Given** a page linked from two other pages by relative links, **When** a member renames it and publishes, **Then** one write renames the file, changes the title and updates both links, and the page keeps its `id`.
- **Given** the pull request is open, **When** a viewer follows either link on the default branch, **Then** the old page is still there; after the merge the new links work.

### AUT-14-S1: Move a page with its children
**As a** member **I want** to move a page under another page **so that** the structure follows how we think. Priority **M**. Depends on Q5, Q8.
- **Given** a page with four child pages and links to it from elsewhere, **When** a member moves it under another page and publishes, **Then** one write moves the folder, and every inbound relative link in the repository is rewritten in the same write.
- **Given** a move that would touch more than the write's 500 files, **When** the member confirms, **Then** the portal refuses it and shows the count and the limit.
- **Given** a target that already holds a page of the same file name, **When** the member picks it, **Then** the move is refused.

### AUT-14-S2: Keep an agent's citations valid after a move
**As an** agent **I want** to find a page by its id after it moved **so that** a citation I made before still leads to it. Priority **M**. Depends on Q5.
- **Given** a page with id `PAGE-PAY-0007` that was moved and merged, **When** the agent calls `brain_lookup` with that id, **Then** the result names the new path and node id.
- **Given** a citation `old/path.md:10-20@<commit>`, **When** the agent calls `brain_read` for that commit, **Then** the earlier text is still returned.

### AUT-15-S1: Copy a page
**As a** member **I want** to copy a page, with or without its children **so that** I start from a proven structure. Priority **S**. Depends on Q5, Q8.
- **Given** a page with children, **When** a member copies it with children to another space, **Then** every copy has a new `id`, links among the copies point at the copies, and links to pages outside the copy are unchanged.
- **Given** a copy of more than 500 files, **When** the member confirms, **Then** it is refused with the count.

### AUT-16-S1: Delete a page knowing what it affects
**As a** manager **I want** a delete dialog that lists the children and the pages that link to the page **so that** I remove a page without breaking others. Priority **M**. Depends on Q8.
- **Given** a page with two children and three pages linking to it, **When** a manager chooses delete, **Then** the dialog lists the children and the three linking pages before it allows the action.
- **Given** the manager confirms, **When** the write ends, **Then** the page's file is removed in one pull request, and the pages that linked to it are listed as having a broken link until they are edited.
- **Given** a manager without edit rights on a child, **When** they delete the parent, **Then** the portal refuses and names the child.

### AUT-17-S1: Bring back a deleted page
**As a** manager **I want** to restore a deleted page from the history **so that** a wrong delete is undone. Priority **S**. Depends on Q8.
- **Given** a page deleted by a merged write, **When** a manager opens the deleted pages of the space, **Then** the page is listed with the commit that removed it and its last text.
- **Given** the manager restores it, **When** the write ends, **Then** the file returns at its old path in a pull request, or in the space root when its parent is gone.

### AUT-19-S1: See who changed a page and when
**As a** viewer **I want** a panel with the page's id, space, author of the last change, dates and status **so that** I can judge how current it is. Priority **S**.
- **Given** a page changed by a merged write, **When** a viewer opens the panel, **Then** it shows the last commit's date, its author and its first message line, and the `id`.
- **Given** a page that is a pending pull request, **When** the panel is shown, **Then** it also says that a change is waiting for review and links to the pull request.

## The editor

### AUT-20-S1: Write Markdown and see the page as readers will
**As a** member **I want** a source editor with a live preview **so that** I know what the published page looks like. Priority **M**. Depends on Q4.
- **Given** an open draft, **When** a member types a table, a Mermaid fence and a link, **Then** the preview shows the table, the diagram and a working link within a second.
- **Given** a Mermaid fence that does not parse, **When** it is previewed, **Then** the preview shows the error and the rest of the page still renders.
- **Given** the member switches to the raw view, **When** they switch back, **Then** the cursor and the draft are kept.

### AUT-21-S1: Let a colleague write without Markdown
**As a** member who does not write Markdown **I want** a rich-text editor **so that** I can author a page with a toolbar. Priority **S**. Depends on Q4 (a later phase, behind a round-trip test).
- **Given** every document of the starter template and a sample repository, **When** each is opened in the rich-text editor and saved without a change, **Then** the saved file equals the original byte for byte.
- **Given** a document that does not round-trip, **When** a member opens it, **Then** the editor opens in source mode and says why.

### AUT-24-S1: Edit a table
**As a** member **I want** to insert a table and add rows **so that** I do not align pipes by hand. Priority **S**.
- **Given** the source editor, **When** a member inserts a table of three columns and two rows, **Then** valid GitHub-flavoured Markdown is added and the preview shows the table.
- **Given** a table is open, **When** a member adds a row, **Then** the pipes are aligned and a cell containing `|` is escaped.

### AUT-25-S1: Show code readably
**As a** member **I want** code blocks to show a language and colours **so that** a sample is readable. Priority **M**.
- **Given** a fence with the language `typescript`, **When** the page is shown, **Then** it is highlighted and horizontally scrollable.
- **Given** a fence with no language, **When** the page is shown, **Then** it is shown as plain text in a block.
- **Given** an agent reads the page with `document_get`, **When** it receives the text, **Then** the fence and its language are unchanged.

### AUT-26-S1: Draw a diagram as text
**As a** member **I want** a `mermaid` fence to render as a diagram **so that** a diagram is reviewed like text. Priority **M** (Kintsugi is ahead of Confluence here, which needs an app).
- **Given** a page with a Mermaid flowchart, **When** a viewer opens it, **Then** the diagram renders, and the pull request diff shows its source.
- **Given** an agent reads the page with the Brain, **When** it reads the section, **Then** it receives the Mermaid source as text.

### AUT-28-S1: Link to a section
**As a** viewer **I want** every heading to be linkable **so that** I can send a colleague to the exact section. Priority **M**. Depends on Q12.
- **Given** a page with a heading "Retry policy", **When** a viewer follows `page.md#retry-policy`, **Then** the portal scrolls to that heading.
- **Given** two headings with the same text, **When** they are linked, **Then** the second one's anchor is numbered as GitHub numbers it, in the portal, the Brain and the link check.

### AUT-28-S2: Cite a section by its anchor
**As an** agent **I want** a node id `path.md#anchor` to match the anchor the portal uses **so that** a human can open what I cite. Priority **M**. Depends on Q12.
- **Given** a section node returned by `brain_tree`, **When** its anchor is used in a portal address, **Then** the portal opens the same section.
- **Given** a heading with non-Latin letters, **When** the Brain and the portal build its anchor, **Then** both give the same anchor.

## Drafts, publishing and concurrent edits

### AUT-31-S1: Lose no work
**As a** member **I want** my edit saved as I type **so that** a closed tab or a crash costs nothing. Priority **M**. Depends on Q1.
- **Given** an open draft, **When** the member types and waits a few seconds, **Then** the draft is saved and the editor shows when.
- **Given** the browser is closed, **When** the member opens the page for editing later, **Then** the editor offers to resume the draft.
- **Given** the draft is saved, **When** the Brain is queried, **Then** the draft's text is not in it.

### AUT-32-S1: Resume or discard a draft
**As a** member **I want** a list of my drafts **so that** I can pick up an edit or drop it. Priority **S**. Depends on Q1.
- **Given** two drafts of the member, **When** they open the drafts list, **Then** both are listed with page title, space and last save, each with Resume and Discard.
- **Given** the member discards one, **When** the list is shown again, **Then** it is gone and the published page is unchanged.

### AUT-33-S1: Publish through review
**As a** manager **I want** a member's page change to arrive as a pull request **so that** I review what gets published. Priority **M**. Depends on Q2.
- **Given** a path that is not in `directPublishPaths`, **When** a member publishes, **Then** a `kintsugi/*` branch and a pull request are opened and the page shows as pending review.
- **Given** the pull request is merged, **When** the Brain next builds, **Then** the page appears in it at the merged text.
- **Given** a path in `directPublishPaths` and a member without `wiki.publish`, **When** they publish, **Then** the change goes through a pull request.

### AUT-33-S2: Read only what is published
**As a** viewer **I want** to see only reviewed text **so that** I do not read a draft by mistake. Priority **M**.
- **Given** a page with a draft and a pending pull request, **When** a viewer opens it, **Then** they see the default branch's text and a notice that a change is waiting for review.
- **Given** a viewer who is not the draft's author, **When** they list the project's pages, **Then** the draft's text is nowhere in the results.

### AUT-34-S1: Never overwrite another person's change
**As a** member **I want** a conflict to be shown **so that** my publish does not silently remove someone's change. Priority **M**. Depends on Q1.
- **Given** a draft started on commit A and the page changed on another line in commit B, **When** the member publishes, **Then** the API merges the two and publishes the merged text.
- **Given** both changed the same line, **When** the member publishes, **Then** nothing is written, and the editor shows the base, their text and the current text.

### AUT-36-S1: Say what changed
**As a** manager **I want** a pull-request title that says what changed **so that** review is quick. Priority **S**.
- **Given** the publish dialog, **When** a member types "Clarify the retry limit", **Then** the pull request title and the commit message's first line are that text.
- **Given** an empty message, **When** the member publishes, **Then** the dialog proposes "Update <title>" and the member may keep or change it.

## Macros and embeds

### AUT-37-S1: Make a warning stand out
**As a** viewer **I want** a note or a warning to look different from text **so that** I do not miss it. Priority **M**. Depends on Q4.
- **Given** a block `> [!WARNING]` followed by text, **When** a viewer opens the page, **Then** it shows a warning box with a title, and on a Git server it still reads as a quote.
- **Given** an agent reads the page, **When** it receives the section, **Then** the block is the same plain Markdown quote.
- **Given** raw HTML in a page, **When** it is shown, **Then** it is not rendered.

### AUT-38-S1: Move around a long page
**As a** viewer **I want** a table of contents of the page's headings **so that** I jump to a section. Priority **S**. Depends on Q4.
- **Given** a page with a block `kintsugi-toc`, **When** it is shown, **Then** a list of the page's headings is shown, each a working link, and the file holds only the block.
- **Given** a block with `levels: 2-3`, **When** it is shown, **Then** only those heading levels are listed.

### AUT-41-S1: List the children without keeping a list
**As a** viewer **I want** a block that lists a page's children **so that** an index page stays true. Priority **S**. Depends on Q4.
- **Given** a page with a block `kintsugi-children`, **When** a page is added under it and merged, **Then** it appears in the listing without any edit of the index page.
- **Given** the file, **When** it is read in Git, **Then** it holds the macro only, never the rendered list.

## Attachments and images

### AUT-44-S1: Attach a specification
**As a** member **I want** to attach a PDF to a page **so that** its source document travels with it. Priority **M**. Depends on Q3, Q9.
- **Given** a draft, **When** a member drops a 2 MiB PDF on it, **Then** the file is kept with the draft and a link to `_attachments/<name>.pdf` is inserted.
- **Given** the member publishes, **When** the write ends, **Then** the pull request holds the page and `<page folder>/_attachments/<name>.pdf`.
- **Given** a file of a type not on the allowlist, **When** it is dropped, **Then** it is refused with the allowed types.

### AUT-45-S1: Put a screenshot in a page
**As a** member **I want** to paste an image into a page **so that** a picture sits where it belongs. Priority **M**. Depends on Q3, Q9.
- **Given** a draft, **When** the member pastes a PNG, **Then** the preview shows it inline and the source holds a Markdown image with a relative path under `_attachments/`.
- **Given** a published page with the image, **When** a viewer opens it, **Then** the image is shown, served with a fixed content type and `nosniff`.

### AUT-46-S1: Replace or remove an attachment
**As a** member **I want** a list of a page's attachments **so that** I can replace or remove one. Priority **S**. Depends on Q3, Q8.
- **Given** a page with two attachments, **When** the member opens the list, **Then** each shows name, size, type and the pages that use it.
- **Given** the member removes an attachment still used by the page, **When** they confirm, **Then** the dialog warns that the page's image or link would break.

### AUT-48-S1: Know the limits before uploading
**As an** admin **I want** the upload limits to be visible and enforced **so that** the repository stays small. Priority **M**.
- **Given** a file of 6 MiB, **When** a member drops it, **Then** it is refused before upload with the limit of 5 MiB per file.
- **Given** a draft whose files together would make a write of more than 50 MiB, **When** the member publishes, **Then** the publish is refused with the sizes.

### AUT-51-S1: Link to an attached file
**As a** member **I want** to link to an attachment from the text **so that** a reader can open it. Priority **S**. Depends on Q3.
- **Given** an attachment `_attachments/spec.pdf`, **When** a member links it and a viewer follows the link, **Then** the file opens as a download or in the viewer and never runs as a page.
- **Given** a link to an attachment that was removed, **When** the link check runs, **Then** the link is listed as broken with its page and line.

## Links and backlinks

### AUT-49-S1: Link to another page by its title
**As a** member **I want** to type `[[` and pick a page by title **so that** I need not know its path. Priority **M**. Depends on Q5.
- **Given** an open draft, **When** a member types `[[Retry`, **Then** matching titles of the project are offered.
- **Given** the member picks one, **When** the draft's source is shown, **Then** it holds a standard relative Markdown link, not a `[[...]]` form.

### AUT-50-S1: Link to a heading of another page
**As a** viewer **I want** a link that leads to a heading **so that** I arrive where the point is made. Priority **M**. Depends on Q12.
- **Given** a link `other.md#retry-policy`, **When** a viewer follows it, **Then** the page opens scrolled to the heading.
- **Given** the heading was renamed, **When** the link is followed, **Then** the page opens at its top and the link check lists the link as stale.

### AUT-52-S1: See what links to a page
**As a** member **I want** a list of the pages that link to the one I am reading **so that** I see the effect of a change. Priority **S**.
- **Given** a page linked from three pages, **When** a member opens its links panel, **Then** the three pages are listed with the sections that hold the links.
- **Given** a page nobody links to, **When** the panel is opened, **Then** it says so and does not show an empty list.

### AUT-52-S2: Ask an agent what links to a node
**As an** agent **I want** the links of a node in both directions **so that** I can answer "what depends on this page". Priority **S**.
- **Given** a node with incoming links, **When** the agent calls `brain_read` for it, **Then** the result lists up to 20 incoming and 20 outgoing links and says the total when it is higher.
- **Given** a link the Brain cannot follow, **When** the agent reads the node, **Then** the link is not in the list and the node does not claim it exists.

### AUT-53-S1: Find broken links before readers do
**As a** manager **I want** a list of broken links in a space **so that** I can have them fixed. Priority **M**.
- **Given** a page that links to a deleted page, **When** a manager opens the link check of the space, **Then** the page, the line and the missing target are listed.
- **Given** the link is repaired and merged, **When** the check is shown again, **Then** it is gone.

### AUT-54-S1: Move without breaking links
**As a** member **I want** links to be repaired when a page moves, is renamed or deleted **so that** I do not repair them by hand. Priority **M**. Depends on Q5, Q8.
- **Given** a page linked from 12 pages, **When** it is moved and the pull request is merged, **Then** none of the 12 pages has a broken link and all 12 files changed in the same pull request.
- **Given** a link the writer cannot rewrite (in a code fence), **When** the move is made, **Then** it is left alone and the move result lists it.

## Export and import

### AUT-55-S1: Hand someone a PDF
**As a** viewer **I want** to print a page to PDF **so that** I can send it to someone outside the portal. Priority **S**. Depends on Q7.
- **Given** a page with a table and a diagram, **When** a viewer prints it from the browser, **Then** the output hides navigation and shows the title, text, table and diagram.
- **Given** a page wider than the paper, **When** it is printed, **Then** tables and code wrap or scale so that no column is cut off.

### AUT-58-S1: Take the Markdown with me
**As a** member **I want** to download a page, or a space, as Markdown **so that** I can reuse it elsewhere. Priority **M** (Kintsugi is ahead here: Confluence has no native Markdown export).
- **Given** a page, **When** a member chooses "Download Markdown", **Then** they receive the file as committed, with its front matter.
- **Given** a space, **When** a member exports it, **Then** they receive an archive of its folder at the commit shown, with its attachments.

### AUT-58-S2: Give an agent the page as Markdown
**As an** agent **I want** the page's source **so that** I can quote it exactly. Priority **M**.
- **Given** a page, **When** the agent calls `document_get` with its path, **Then** it receives the Markdown as committed, up to the size limit, and says when the file is larger.
- **Given** a binary attachment path, **When** the agent calls `document_get`, **Then** it gets a clear refusal, and the Brain page names the attachment with its size and type.

### AUT-59-S1: Bring in a Word specification
**As a** member **I want** to import a `.docx` as a page **so that** an existing document becomes part of the wiki. Priority **S**. Depends on Q7 (needs a converter dependency and its own ADR).
- **Given** a `.docx` with headings, a table and an image, **When** a member imports it, **Then** a draft is created with the headings, a table and the image under `_attachments/`.
- **Given** a drawing the converter cannot read, **When** it is imported, **Then** the draft names it in a notice and does not drop it silently.

### AUT-60-S1: Bring in Markdown documents
**As a** member **I want** to import Markdown files into a space **so that** documents I already have become pages. Priority **S**. Depends on Q5.
- **Given** a Markdown file without front matter, **When** a member imports it into a space, **Then** the draft has a new `id`, a title taken from its first heading, and its relative image links are reported when they do not resolve.
- **Given** a file with front matter that already has an `id`, **When** the id exists in the project, **Then** the import is refused and names the page.

## Coverage

Every Must and Should row of the matrix has at least one story above. Rows with priority C or W have none on purpose; the product owner may promote one, and its story is then written from the matrix row.
