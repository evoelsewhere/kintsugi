# ADR-0046: One file per business rule, indexed by `rules.md` and `BUSINESS_RULES.md`

- Status: Accepted (amends [ADR-0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md), [ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md))
- Date: 2026-10-21
- Decision register: D62

## Context

A unit's `understanding/rules.md` held every rule as a card, and `generated/BUSINESS_RULES.md` joined the cards of all units. A card had to stay small to keep the file readable, so the detail a rebuild needs (decision table, inputs and outputs, evidence line by line, acceptance scenarios, how a rule changed between extractions) did not fit. The aggregate grew with every unit, a review of one rule meant a diff in a large shared file, and nothing recorded that a rule had changed or gone away.

## Decision

1. **A rules index and one file per rule.** `understanding/rules.md` of a unit and `generated/BUSINESS_RULES.md` of an application are **indexes**: a table with `ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file` (the application index adds `Item`), the explicit no-rules line when it is empty, and, in a unit index, a table of retired rules. They hold no rule cards.
2. **The rule file is `understanding/rules/<rule id>.md`** next to the unit's index (`unitRuleFilePath`; `<rule id>` is the stable citation-derived id of ADR-0038). Front matter: `id`, `name`, `app`, `item`, `category`, `priority`, `confidence`, `status`, `version`, `digest`, `sourceCommit`, `source`, `dataObjects`, `config`, `tags`. Sections: Summary, Specification (Given/When/Then), and, when the analysis has evidence for them, Decision table, Flow (Mermaid), Parameters, Inputs and outputs, Evidence, Edge cases, Suspected defects; then Open questions, Acceptance scenarios and Version history. A section without evidence is left out, never guessed.
3. **Versions follow the content.** `split_rules.py` reads the rule files already in the document repo (`--docs`). A rule whose `digest` is unchanged keeps its version and history; a changed rule gets the next version and a history row (date, change, source commit); a rule that is no longer extracted is rewritten as a `retired` file (a tombstone) and listed in the index's retired table. The index's `catalogVersion` rises when any rule is added, changed or retired. A rerun that changes nothing writes the same bytes.
4. **Files stay with their unit.** The application index links to the unit's files (`../units/<module>/<unit>/understanding/rules/<id>.md`); `rebuild_aggregates.py` copies no rule file, so the generated views stay small and a run's pull request still touches only its own units.
5. **Readers.** `parseRules` (the reader) reads the index rows; the API resolves each row's link to a repository path and the portal opens the rule's file in the rule drawer. Cards in older documents are still read. `design_lib.py` reads the index rows.
6. **The JobOutput hook** checks an index (valid rule ids, a link to an existing file for each row of a file in the output; links leaving the output tree are not followed) and a rule file (front matter `id` equal to the file name, a `# <id>: …` title).
7. **Extraction.** The extract-rules workflow may return the optional detail fields of a rule (`inputs`, `reads`, `writes`, `outputs`, `errors`, `dataObjects`, `config`, `tags`, `decisionTable`, `evidence`, `acceptance`); `render_rules.py` (the whole-application form, rules numbered `RULE-NNN` in `rules/`) and `split_rules.py` write them.

## Consequences

- A rule is reviewed, linked from requirements and designs, and traced as a document of its own; its history is in the file and in Git.
- The number of files grows with the number of rules. Rule files of one unit sit in one folder; the index is the entry point.
- A rule that disappears stays in the repository as a `retired` file: nothing is deleted by a run.
- Extraction costs more tokens per rule when the optional fields are asked for; they stay optional.
- `rules-review.md` is unchanged: a verdict still keys on the rule id and is reported as orphaned when the id is not in the index.
- Existing document repos keep working: the old cards are read, and the next `understand` run rewrites a unit's `rules.md` as an index and writes its rule files. Rules extracted before this decision start at version 1.

## Alternatives considered

- **Rule files in `generated/rules/`** – one flat folder per application. Rejected: the aggregate rebuild would copy every file on each merge, and a run's rule file would be written outside its unit's pull request.
- **A slug in the file name** (`RULE-…-account-locks-after-failed-logins.md`). Rejected: the name of a rule can change while its id stays; the id alone keeps links and tombstones stable.
- **Keeping cards in `rules.md` and adding the detail there.** Rejected: the file would not stay reviewable, and per-rule history would not have a place.
