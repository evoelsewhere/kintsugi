# Collaboration and access: research pages

> Status: research, proposed. How Kintsugi would offer what a Confluence-like wiki offers for working together on pages and for controlling who may do what: page and inline comments, mentions, watching and notifications, co-editing, approvals, sharing, space and page permissions, restrictions and audit. Part of the Confluence parity research (`../README.md`).

| Page | What it holds |
|---|---|
| [Feature matrix](feature-matrix.md) | 39 features (COL-01..COL-39) with the Confluence behaviour, a public Atlassian source, what Kintsugi has today with its repo path, a MoSCoW proposal and the personas each Must and Should row serves |
| [User stories](user-stories.md) | 27 stories with Given/When/Then criteria covering every Must and Should row, with negative criteria where access is involved |
| [Gap analysis](gap-analysis.md) | What exists in code and documents, the smallest step for each row, the permission mapping onto ADR-0008 and ADR-0024, the state that cannot live in Git, and the co-editing recommendation |
| [Open questions](open-questions.md) | Q1-Q15, the constraint questions raised with the architects (Markdown-only repo, Git as source of truth, Postgres only, identity model), the options and the decisions |
| [Git-backed wiki comparison](git-wiki-comparison.md) | How Wiki.js, BookStack, Outline, GitBook and Docusaurus handle comments, notifications, permissions, co-editing, Git storage and audit, and what each finding means for a decision |

## In one paragraph

The rule behind the pack: reviewed page content stays in Git, conversation and per-user working state (comments, watches, notifications) live in Postgres, and the Brain indexes Git only. Access reuses the existing identity model: Project Access for reading, four new permission codes (`wiki.comment`, `wiki.write`, `wiki.publish`, `wiki.manage`) for acting, and edit restrictions per path prefix that are enforced where a page is published. A view restriction on Git content is declined because every clone holds the text; authored restricted pages are a late-phase candidate for the owner. Simultaneous co-editing is a Won't: presence, a base-commit check at publish and a three-way merge replace it.

The architecture that carries this is in `../40-architecture/target-architecture.md`, the data in `../40-architecture/data-model.md`, and the decision in `ADR-0099` (`../../../decisions/0099-wiki-collaboration-and-access.md`).
