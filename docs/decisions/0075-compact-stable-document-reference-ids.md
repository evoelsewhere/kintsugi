# ADR-0075: Compact stable document reference IDs

- Status: Accepted
- Date: 2026-10-25
- Decision register: D89

## Context

Rule IDs embed long module and unit paths and citation hashes. Security findings are renumbered by severity on each extraction, and specification jobs assign gap numbers themselves. These references are hard to scan and unsafe to reuse in reviews and designs when numbering changes. Document repositories contain Markdown only, and concurrent understand runs must write disjoint unit paths.

## Decision

Publish `RULE-<scope>-0001`, `SEC-<scope>-0001` and `GAP-<scope>-0001`. Assess allocates a short immutable module `code` and unit `referenceCode`, such as `CARD` and `CARD01`, in the catalog. Reconciliation preserves them across renames, moves and retirement. The scope is unique within the application; a cross-application reference also needs its application/document path. Canonical unit paths and database IDs keep their existing meaning.

Each unit stores three independent Markdown allocation ledgers under its legacy `identifiers/` directory. The split scripts allocate RULE and SEC IDs; the finish script allocates GAP IDs and rewrites draft references in the specification. Allocation uses persisted identity fingerprints, not presentation order. Removed entries remain retired. New identities append after the highest sequence; an exact returning identity can reactivate its ID. An unambiguous active rule citation or security citation/CWE can preserve an ID when its label changes. Ambiguous matches receive fresh IDs; contradictory records sharing one identity fail rather than select one by array order.

Catalog allocation happens during assess, before users select units. Concurrent understand runs on distinct units therefore share no counter or ledger. Start and Retry serialize scope admission with a transaction advisory lock in Postgres, checking persisted runs before inserting or requeueing. Understand claims units; design claims units within a set. Active runs and unresolved document writes exclude overlapping selections until resolved or abandoned. A retry is rejected if another run merged output for its units after its original admission, because its pinned ledger is stale; start a new run instead. Allocation introduces no runtime kernel tool, database table or infrastructure dependency.

The reference contract and matching boundaries are specified in [document identifiers](../reference/document-identifiers.md). It supersedes the citation-hash rule ID policy of ADR-0038 and the regeneration numbering policy for gaps of ADR-0057. The per-rule files and version history of ADR-0046 remain in use. Readers accept historical IDs; new generation requires an assessed catalog and intact ledgers. Existing repositories need a deliberate regeneration before using this writer contract; there is no automatic rewrite of human reviews or existing design references.

## Consequences

References are short, persistent and usable in tables, reviews and designs. Identity fingerprints stay internal to the Markdown ledgers. Labels and severity can change without renumbering matching entries. Missing or corrupt allocation history fails closed; restore it from Git. Source relocation or a changed question can represent a new identity and therefore allocate a new number. Project-owned design templates retain their existing short ID conventions.

## Alternatives considered

- Truncate a UUID or citation hash: compact, but still opaque and collision prone when shortened.
- A single counter per module: every unit run would contend for the same document or need a new allocation service.
- Number each extraction from one: breaks references after insertion, removal or severity changes.
