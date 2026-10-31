# ADR-0091: The Brain, a vectorless tree index of the document repository that agents reason over

- Status: Accepted (supersedes the embedded, chunked KB of [ADR-0014](0014-no-code-graph-no-agent-config.md) decision 1; amends [ADR-0069](0069-common-member-base-and-plugin-distribution.md) member tools)
- Date: 2026-10-31
- Decision register: D105

## Context

Members ask their own agents questions about a project: what a standard says, how a rule was understood, which unit owns a table, what the transition plan decided. The answers are in the project's document repository, but the member base only offers `document_tree` and `document_get`: an agent must guess paths and read whole files, up to 2 MiB each.

The plan of record was a knowledge base of chunks embedded with pgvector ([ADR-0014](0014-no-code-graph-no-agent-config.md), the M1 roadmap). It was never built. Chunk similarity loses the structure of a document and cannot show why a passage was chosen, and the accuracy of vector retrieval on technical documents has not been shown to be good enough to rely on. Its answers cannot be checked. An answer has to be traceable to the lines it came from.

The documents are well structured already. Folders are numbered in reading order ([ADR-0051](0051-document-repo-layout-legacy-and-modern.md)), every document is Markdown with front matter, headings and cards ([ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md)), and facts carry stable ids ([ADR-0075](0075-compact-stable-document-reference-ids.md)). Reasoning-based retrieval over a document tree (the approach PageIndex calls vectorless RAG) uses that structure. The reader sees a table of contents with summaries, chooses where to look, reads it and cites it. A member's agent can do that reasoning itself.

## Decision

1. **A tree, not chunks.** The Brain of a project is a tree of its document repository: the root, a folder per directory, a document per Markdown file, a section per heading, and a card per heading that starts with a reference id (`RULE-…`, `SEC-…`, `COM-…`). Each node has a title, a one-line summary, its line range, its size in tokens and the ids it defines. Node ids are readable and stable for a commit: `/`, `folder/`, `path.md`, `path.md#anchor` (a card's anchor is its id).
2. **No model and no embedding builds it.** Summaries come from the documents themselves: front matter `summary`/`description`, the first paragraph, a card's fields, a table's columns, a diagram's kind, a folder's README, or what the layout says a folder holds (`describeDocumentFolder`). Each node records where its summary came from, so a reader knows how much to trust it. The builder lives in `packages/domain/src/brain.ts`; it is deterministic and tested.
3. **One branch, chosen per project.** A manager (`project.brain.manage`) chooses the branch, usually the default branch: what people merged. Kintsugi's own `kintsugi/*` output branches are refused because they are not reviewed. The index is off until a manager builds it.
4. **The text stays in Git.** Postgres keeps the tree and the links (`knowledge.brain_source`, `brain_node`, `brain_link`, migration 043), as the installation keeps indexes ([ADR-0007](0007-git-as-source-of-truth.md)). Nodes hold line ranges. A read takes those lines from the mirror at the indexed commit, so a citation `path:lines@commit` always matches what was read.
5. **The worker builds it whole when the branch moves.** The worker runs one build per project on the queue `brain-index`. A build is requested by the manager, by a sync that moved the default branch, or by a check every minute for other branches, builds lost with a stopped worker and a newer builder. It reads every indexed Markdown blob of the commit in one batch and replaces the tree in one transaction. A failed build is recorded and not tried again on the same commit, and the previous tree stays readable meanwhile. Bounds: 20,000 documents, 2 MiB per file, 2,000 headings per document, 50 links per node. `restricted/`, `plugins/`, `scratch/`, identifier ledgers and hidden folders are left out.
6. **Members' agents do the reasoning.** The member API and the local MCP bridge gain four read tools: `brain_tree` (one level with summaries, no text), `brain_read` (a node's text with its citation, children and links, in bounded parts), `brain_lookup` (an id, node id or path) and `brain_grep` (an exact string, mapped back to nodes). Nothing ranks by similarity. Kintsugi calls no model at query time, and the member's own harness spends the reasoning. The server instructions and tool descriptions tell the agent how to proceed: start at the root, descend by the summaries, read, cite, and say so when the Brain does not hold the answer. Text read from the Brain is project data, not instructions. A `brain_read` is recorded as member activity `brain.read`.
7. **People see the same tree.** The portal's Brain page shows the index state, the branch and the build, the tree with summaries, a node's text with its citation and links, and the same lookup and search.
8. **Accuracy is measured before it is claimed.** The Brain is judged by answers and citations on known questions against the plain document reads, with the known-answer approach of [ADR-0084](0084-known-answer-evaluation-of-the-built-in-plugins.md), before it is described as better: the [Brain eval](../development/brain-eval.md).

## Consequences

- An agent reaches a passage by a path of summaries it can explain, and cites lines at a commit that anyone can open. A wrong answer can be traced to the summary or the reading that misled it.
- There is no embedding model to host or choose, no vector column and no extra infrastructure. The pgvector image stays as it is but is unused. Builds take seconds and cost no tokens.
- Quality depends on how documents are written: a folder without a README, a document without an opening paragraph or a long section without subheadings gives a weaker summary. Agent-friendly pages (a later decision) are written for the tree.
- An answer costs the member's agent several tool calls instead of one similarity query. Lookups and exact search are the shortcuts.
- The tree is rebuilt whole on every move of the branch. That is cheap for document repositories. Incremental builds are possible later without changing the contract.
- Runtime agents do not use the Brain yet. They read their pinned checkouts directly.

## Alternatives considered

- **Embedded chunks with pgvector (ADR-0014).** Rejected: similarity cannot explain its choice, loses the document's structure and needs an embedding model per installation; its accuracy on these documents is unproven.
- **Model-written summaries at build time (as PageIndex can).** Deferred: the documents already summarise themselves well enough to start, and a model call per node adds cost, latency and unverifiable text. It can be added for long nodes without one, cached by content hash, if evaluation shows a need.
- **Using PageIndex itself.** Rejected: it is Python and PDF-first, its multi-document features and MCP server are a paid cloud service, and its Markdown parser does not know Kintsugi's cards, ids and layout. The principle is adopted, not the package.
- **Full-text ranking in Postgres.** Not adopted as the primary path: a ranked list hides why a passage was chosen. Exact search (`brain_grep`) is offered as a deterministic shortcut instead.
