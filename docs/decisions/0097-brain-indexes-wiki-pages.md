# ADR-0097: The Brain indexes and serves wiki pages, builds incrementally and keeps a full-text index

- Status: Proposed (amends [ADR-0091](0091-brain-vectorless-tree-index.md) decisions 3, 5 and 6)
- Date: 2026-11-02
- Decision register: D111

## Context

[ADR-0096](0096-wiki-pages-in-the-document-repo.md) makes wiki pages Markdown documents of the project's document repository. The Brain ([ADR-0091](0091-brain-vectorless-tree-index.md)) already indexes those as a tree of folders, documents, sections and cards, with summaries from the documents, links and ids, and serves it to the portal and to members' agents with citations `path:lines@commit`. Three things it does not do yet matter for a wiki:

- Pages carry attributes the tree should show and filter by: labels, status (archived), owner, a template flag, the manual order of a folder's pages, the space a folder is, and the attachments a page links to.
- A wiki moves its branch on every direct publish and merge. A Brain build reads every Markdown blob of the commit, up to 20,000 documents. ADR-0091 said incremental builds were possible later without changing the contract.
- People searching a wiki expect ranked results over all pages. `brain_grep` finds lines that hold every word, at most 50, unranked. ADR-0091 did not adopt full-text ranking as the primary path, because a ranked list hides why a passage was chosen.

The research behind this decision is in the parity research pack: [Brain integration](../research/confluence-parity/40-architecture/brain-integration.md).

## Decision

1. **No new node kinds; pages get attributes.** A space is a folder, a page a document. The builder reads front matter `labels`, `status`, `owner`, `type: template` and a home page's `key` into new columns of `knowledge.brain_node` (`labels` with a GIN index, `status`, `owner`, `template`, `space`) and records the `_attachments/` files a page links to (name, media type, size, alt text; at most 50) on its node. A folder that is a page takes its `README.md`'s attributes.
2. **Manual order.** A folder's `README.md` front matter `order` lists entry names: those come first, folders and documents mixed, in list order; the rest keep today's order. No existing repository changes order.
3. **Summaries know wiki markup.** Fenced `kintsugi-*` macro blocks are skipped like code; a GitHub alert is read without its marker; `archived` joins the status words that start a summary; a template's summary starts with `Template.`
4. **Archived pages and templates are left out by default.** `brain_tree`, `brain_grep` and `brain_search` leave them out unless the caller asks for them and say how many were left out. `brain_read` and `brain_lookup` still find them.
5. **A wiki project indexes its default branch** (amends decision 3). Turning the wiki on turns the Brain on for the default branch; the branch of a wiki project's Brain cannot be changed. Drafts and pending pull requests are never indexed: a page appears in the Brain when its commit is on the default branch and the next build has run, and its citations name that commit.
6. **Builds are incremental when safe** (amends decision 5). When the stored tree has the same builder version and its commit is an ancestor of the tip, and the diff touches at most 2,000 indexed files or a fifth of them, a build reads only the changed documents, rebuilds their nodes and the folders above them, and re-resolves the links that point at changed paths or ids, in one transaction. Every reference of a node, resolved or not, is kept in a new table `knowledge.brain_ref` so that resolution is a join; the references that resolve to nothing are the wiki's broken-link report. After a build of the default branch, the changed documents are matched against the wiki's watches and each change is notified once through the worker's outbox, so pages changed by members' own pull requests notify too. A whole build stays the fallback, the Rebuild action and the check run after every 50 incremental builds; a whole and an incremental build of the same commit must store identical rows, which a property test of the builder proves.
7. **A full-text index is built with the tree** (amends decision 6). `knowledge.brain_text` holds one `tsvector` per document, section and card for its own text (title weighted above headings and labels, above body; the `simple` configuration unless the installation chooses another), built from the same blobs in the same transaction. It stores lexemes, not text; the text stays in Git. A new read, `brain_search` (portal, member API, MCP tool), returns ranked hits as tree nodes with their breadcrumb, summary, first matching line and citation. It is a shortcut next to `brain_lookup` and `brain_grep`: the instructions keep tree navigation first, and nothing is embedded or ranked by similarity of meaning.
8. **Reads gain fields, not new shapes.** `brain_tree` and `brain_read` return the new attributes; `brain_read` pages through links beyond the first 20 each way (the wiki's backlinks); `brain_lookup` also takes `label:<name>` and `space:<key>`; `brain_changes` is unchanged. Comments are not part of the Brain: agents read them through a separate tool defined with the collaboration decision, never inside `brain_read`.
9. **Access is unchanged.** The tree is not filtered per reader, because nothing a project member may not read is in Git ([ADR-0096](0096-wiki-pages-in-the-document-repo.md) decision 8). `restricted/`, `scratch/`, `plugins/`, hidden folders and identifier ledgers stay out. The portal's Brain reads check Project Access like the member reads.
10. **The builder version goes to 6**, so every existing index is rebuilt once with the new columns, and the Brain eval gains wiki questions (label lookups, moved pages, answers only search finds) and compares answers with and without `brain_search` before the tool is described as an improvement ([ADR-0084](0084-known-answer-evaluation-of-the-built-in-plugins.md)).

## Consequences

- The wiki's tree, labels, backlinks and search are reads of one index; there is still no embedding model, vector column or new infrastructure.
- A one-page publish costs a build that reads one blob and writes a few hundred rows instead of reading the repository; a page is in the Brain seconds after a direct publish, and within about a minute of a merge (the review watch's interval).
- Cost: `brain_node` gains six columns; `brain_ref` adds at most about 1.2 rows per stored link; `brain_text` adds one row per document, section and card, smaller than the text (a few to tens of megabytes for a repository of a few thousand pages). The member base gains one tool (`brain_search`, six Brain tools in all) and the wiki adds one comment tool outside the Brain.
- Incremental builds add a second code path to keep equal to the first; the property test and the periodic whole build are what keep it honest.
- Agents might lean on `brain_search` instead of navigating; the instructions and the eval watch for it, and an installation can withhold the tool.
- A wiki project can no longer point its Brain at a branch other than the default one.

## Alternatives considered

- **New `space` and `page` node kinds.** Rejected: every client and the agent instructions know the five kinds; a space is a folder and every document is already a page, so attributes carry the difference without breaking the contract.
- **A separate wiki index or search engine.** Rejected: two indexes of the same commit drift, and a search engine is a new infrastructure dependency ([ADR-0010](0010-postgres-only.md)).
- **Keep whole builds only.** Rejected for wiki projects: every publish would read the whole repository, and a burst of publishes would keep the index behind the branch.
- **Vector search over pages.** Rejected again for the reasons of ADR-0091: it cannot explain its choice and its accuracy on these documents is unproven.
- **Filter the tree per reader.** Rejected: summaries, links, grep and search hits and changes would each need a filter that can leak, and it would protect nothing that members' clones do not already hold.
