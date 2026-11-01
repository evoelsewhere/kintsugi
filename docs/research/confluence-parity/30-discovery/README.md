# Finding and lifecycle: research pages

> Status: research, proposed. How Kintsugi would offer what a Confluence-like wiki offers to find content and to manage its life: search, labels, templates and blueprints, version history with compare and restore, archive, page analytics, starred and recent pages. Part of the [Confluence parity research](../README.md).

| Page | What it holds |
|---|---|
| [Feature matrix](feature-matrix.md) | Every feature with its Confluence behaviour, a public source, what Kintsugi has today and a MoSCoW proposal; how search relates to the Brain; why each Must and Should row matters |
| [User stories](user-stories.md) | Stories with Given/When/Then criteria for the member, manager, admin, viewer and agent personas, and a coverage table of the matrix |
| [Gap analysis](gap-analysis.md) | What exists in the code and documentation, what is missing, the smallest closure and the constraint each row touches; the recommendation on ranked search against [ADR-0091](../../../decisions/0091-brain-vectorless-tree-index.md); how history, compare, restore and archive map onto Git |
| [Open questions](open-questions.md) | The seven constraint questions raised with the architects, their options and decisions |

## In one paragraph

Git already holds every version of every page, so history, compare, restore and archive are reads of Git plus new writes through the existing write path; labels, status and templates are front matter and Markdown, so the Brain can read them; the only new stores are derived and rebuildable (a ranked full-text index built with the Brain) or personal and telemetric (starred, recent, view counts) and live in Postgres. Tree navigation stays the way an agent reasons; ranked search is a second path that always shows the matching line and its citation `path:lines@commit`.
