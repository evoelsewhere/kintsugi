# ADR-0085: Check every citation against the source, and bound every claim of absence

- Status: Accepted
- Date: 2026-10-28
- Decision register: D99
- Amends: [ADR-0057](0057-evidence-marks-and-gaps.md) (the `confirmed` mark and the gaps it leads to)

## Context

[ADR-0057](0057-evidence-marks-and-gaps.md) made a citation the whole of a `confirmed` mark: `<repository id>/<path>:line`, and nothing else. Nothing checks it. A citation can name a file the repositories do not have (the copybook that is missing is the likeliest one to be cited), a line past the end of a file, or a path in no repository; it then reads as confirmed and is not. The citation referees of `extract-rules` are agents and read only the rules; the specification, where most citations are, has none.

Two kinds of statement are also confirmed too easily:

- **Absence.** "Nothing calls X", "this paragraph is dead", "only Y writes table Z": a statement about everything the analyst did not read. ADR-0057 asks for the search only when a file is called missing. Legacy code builds names at run time (dynamic calls, table-driven dispatch), and callers live in job descriptors and configuration outside the repositories, so a search that found nothing is evidence about its own scope only.
- **Execution.** Reading the code shows what it can do, not what it does in production: which branch runs, the volumes, the values the data holds.

The [known-answer eval](0084-known-answer-evaluation-of-the-built-in-plugins.md) measures citation validity and plants a dead paragraph and a look-alike callee for these cases; it needs the same notion of a valid citation as the stage.

## Decision

1. **One citation check, shared.** `reverse_engineering/scripts/citations.py` finds the citations of a document (`<path with an extension>:<line>[-<line>]`) and checks each against the legacy checkout: it names a file of one of the repositories (a leading `as-is/` is dropped; a path without its repository id resolves when exactly one repository has it, as `catalog_common.Owners` resolves it), the file has the lines, and the line is not 0. A path that names a document of the document repository (a Markdown file, or under one of its root folders) is not a source citation and is skipped. A path that leaves the repository does not resolve. The eval's scorer uses the same module, with the fixture as the repository.
2. **The understand stage reports, never corrects.** `finish_items.py` takes `--src` (the plan passes `{src}`, the read-only `as-is/` of the job), checks the citations of each unit's `spec.md`, `rules.md` and `findings.md`, and writes into the unit's `understanding.md` the number of source citations (`citations`), those that do not hold (`citationsInvalid`) and a section *Citations that do not resolve* (citation, document, why; at most 40 rows), and prints each one in its output. It does not fail the step and does not change the documents: the pull request is where a person corrects them, as for a gaps table that does not read (ADR-0057, decision 3). Without `--src` nothing is checked and the record is as before. Design readiness does not read the new fields.
3. **A claim of absence carries its search.** The skill `evidence-marks` gains *Saying something is not there*: a statement that something does not exist or does not happen writes what was searched, where, and that nothing was found; without it, it is `inferred`. The search covers only its scope: when a name built at run time, a caller outside the repositories or a generated file is plausible, the absence is a gap of kind `unresolved`. In a source with an open `missing-source` gap, "not found" means not found in what was provided.
4. **Confirmed is not observed.** The skill says that `confirmed` means the code says so; behavior in production (how often a branch is taken, volumes, timings, data values) without data, a log or a test is `inferred` or an `unverified` gap. A citation the check lists supports nothing.
5. **The agents follow.** `legacy-analyst` 1.4.0 writes the search behind a claim of absence; `business-rules-extractor` 1.3.0 says when a rule comes from code nothing appears to run, with the search; `design-reviewer` 1.4.0 reports an **absence taken on trust** (behavior a design leaves out because a statement without a search says it never happens) as a `fidelity` finding, `major` when it removes behavior. `reverse_engineering` becomes 2.3.0 and `modernize` 5.1.0.

## Consequences

- A reviewer sees in the understanding record which citations to fix, and the eval measures citation validity with the stage's own rule.
- The check is shallow on purpose: a citation that names a real line can still not support its statement. It catches invented files and lines, not misreadings.
- Paths with spaces or without an extension are not recognised as citations; they are neither checked nor counted.
- The rule on absence is an instruction, checked by the reviewer and measured by the eval's heuristics, not by a script.

## Not done

- Failing a run, or blocking the design, on unresolved citations: the count is reported first and its level judged on real runs.
- Checking the citations of designs and of the assessment.
- Recording which lines a job actually read, so that a citation of a line nobody read is caught: that needs the kernel to keep a record of reads, a later decision.

## Alternatives considered

- **Correct a citation automatically** (the nearest line with similar text): it would turn an invented citation into a plausible one, which is worse than a visible error.
- **A referee agent per specification**, like the rules' citation referees: costly for what a script decides exactly.
