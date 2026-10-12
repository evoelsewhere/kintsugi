---
name: reverse-design
description: Generate an AS-IS detail design document (markdown) for one feature from legacy source code, using the project's DD template. Use when working on a reverse-design task from a Kintsugi task pack.
---

# Reverse design

## Inputs
- Task pack (`tasks/<id>.md` in the document repo, via `kintsugi task start` or MCP `task.get`): feature scope and entry points (controllers, pages, jobs).
- DD template: `references/dd-template.md` from the project's TO-BE KB (fetch with MCP `kb.search` if not provided).

## Steps
1. Locate entry points and trace the call graph down to data access; list every file you read.
2. Extract: screen/API spec, business rules, validation, data entities and queries, external interfaces, error handling.
3. Fill the DD template. Mark anything inferred rather than read from code as `[INFERRED]`.
   Draw diagrams in Mermaid only, following the `mermaid-diagrams` skill of the Kintsugi plugin:
   - each main flow as a `sequenceDiagram` (`autonumber`; `alt`/`else` for branches, `opt` for optional
     steps, `loop` for repetition; participants declared up front, at most 12);
   - the data entities as an `erDiagram` (key attributes marked `PK`/`FK`, every relationship labelled
     with a valid cardinality such as `||--o{`);
   - legacy names as quoted labels on sanitized ids, never pasted raw.
   Run the skill's `mermaid_lint.py` on the document and fix what it reports before you commit.
4. Record gaps between code and existing documents as a GAP list section.
5. Save the document at the path given in the task pack (document repo), commit it on your branch, open a PR, and register it with `kintsugi artifact register` or MCP `artifact.register` (type `detail-design`). Do not modify source code in this stage.

## Output quality bar
- Every business rule cites `path:line`.
- No invented behavior; unknowns go to "Open questions".
- Every diagram passes the Mermaid lint and is backed by cited facts in the text.
