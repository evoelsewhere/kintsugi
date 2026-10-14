# ADR-0032: Mermaid for every diagram, drawn by a built-in skill and checked by a lint

- Status: Accepted
- Date: 2026-10-12
- Decision register: D51

## Context
The runtime stages write diagrams: `assess` the domain diagram (`ARCHITECTURE.mmd`), `map` a call graph, a data lineage and a critical path, `understand` the flows of each unit, the AS-IS architecture and the data model ([ADR-0031](0031-understand-stage-as-is-specification.md)); members write a target architecture and a phase plan in the brief. Until now each command said only "a Mermaid graph" with a rough edge limit. Agents wrote `graph TD` or `flowchart`, quoted labels or not, and pasted legacy names (with dots, brackets, quotes, keywords such as `end`) as node ids. Such diagrams fail to render, and a name crafted in the source could carry a `click` link into a committed document.

Constraints: runtime agents have no shell ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)) and receive only `SKILL.md` text in their system prompt ([ADR-0023](0023-runtime-as-generic-agent-kernel.md), [ADR-0026](0026-runtime-agents-and-agent-builder.md)); Kintsugi ships no stack-specific content and adds no infrastructure dependency (no Node renderer or headless browser in the worker).

Options: write the rules into every command (repeated, drifts); render with the Mermaid CLI in the worker (a browser dependency); a shared skill plus a standard-library lint.

## Decision
1. **Every diagram in Kintsugi is Mermaid**: a `.mmd` file with one diagram, or a `mermaid` fence in Markdown. No PlantUML, ASCII art or images.
2. A built-in shared skill, `packages/agents/builtin/plugins/understand/skills/mermaid-diagrams/`, says how: the diagram type per artifact (domain architecture `flowchart TB` with a subgraph per domain and classes by kind; call graph `flowchart TD`; data lineage `flowchart LR`; critical path `flowchart TD`; unit flows `sequenceDiagram`; data model `erDiagram`; lifecycles `stateDiagram-v2`; target architecture `C4Container`; phases `flowchart LR`, never `gantt`), syntax-safety rules for untrusted names (sanitized and prefixed ids, quoted and escaped labels, no keywords, no theming, no `click`/`href`), and size limits (40 edges, about 25 nodes, 12 participants; collapse or split beyond them). It is adapted from softaworks/agent-toolkit (MIT, pinned commit, see the package `NOTICE`); its `references/` hold condensed syntax per type and stay on disk for people and members, since the kernel loads `SKILL.md` only.
3. The runtime agents that draw (`legacy-analyst`, `business-rules-extractor`, `architecture-critic`) load the skill; commands name it in `metadata.skills`, and a test checks that a runtime stage's agents carry every skill the stage names. The member plugin gets the same skill.
4. `scripts/mermaid_lint.py` (standard library, offline) checks the rules; it renders with `mmdc` only when that is installed. Members run it before they commit. The JobOutput hook runs it over every `.mmd` and Markdown output and reports **warnings** that never block: agents cannot run it themselves, the lint is a heuristic subset of the grammar, and a diagram problem is not worth discarding a valid output. The worker keeps the count and the first warnings on the step summary.

## Consequences
- Diagrams render predictably and legacy names cannot break or inject into them; reviewers see lint warnings on the job.
- Every runtime job of the three agents carries the skill text (about 10 KB) in its system prompt.
- The skill amends the "no new skill" note of ADR-0031: the understand stage's diagrams follow it.
- Follow-up: the Harness Hub copies the skill and the lint into the generated member plugin; the portal may show the step's diagram warnings.

## Alternatives considered
- **Mermaid CLI in the worker** as a blocking check: a Node and headless-browser dependency in every installation for a cosmetic check.
- **Blocking on lint problems**: would discard expensive analysis for a quoting mistake the agent cannot detect without a shell.
- **Other diagram languages** (PlantUML, D2, Structurizr): need renderers the portal and the Git hosts do not have.
