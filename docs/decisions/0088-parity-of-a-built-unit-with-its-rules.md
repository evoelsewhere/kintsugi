# ADR-0088: Show the parity of a built unit with its rules, each claim at its own level of evidence

- Status: Accepted
- Date: 2026-10-29
- Decision register: D102
- Amends: [ADR-0071](0071-members-build-runtime-reviews.md) (what a member records and what the review publishes)

## Context

A rebuilt unit is worth what it proves about the old one: that each business rule still holds. Today the evidence is scattered. The member's `build` command names each rule in the code and in its tests and records counts (`cases`, `failed`, `canary`); the runtime's `code-reviewer` reads the merge request and reports findings, but cannot run it ([ADR-0071](0071-members-build-runtime-reviews.md)). Nothing says, rule by rule, what supports the claim that the new code does what the rule says, and nothing keeps apart what Kintsugi read itself from what the member reported. A review that reads "clear" says nothing about a rule nobody tested.

Evidence-first reconstruction tooling verifies a rebuilt function against a finite, declared set of claims: a claim passes only for what was declared and compared, any unknown keeps the whole verdict unknown, and a comparison with the original on many inputs is the strongest evidence of equivalence. The same discipline fits here, with the honesty that the runtime runs nothing.

## Decision

1. **The member reports per rule and against the legacy system.** `build.test` and `build.mr` gain `rulesPassed` and `rulesFailed`: the ids of the rules whose tests all passed, and of those with a failing test, each one comma-separated string (activity values are scalars of at most 500 characters; `rulesPassed` `*` means every rule a test names, except the failed ones). When the legacy system can run where the member works, or its inputs and outputs are recorded, the `unit-testing` skill has the member compare the new code with it on the same inputs (cases from the rules' Given/When/Then and boundaries, recorded inputs, replayed recorded traffic for a web application) and record `legacyCases` and `legacyMatched`. Counts and rule ids only, as before no code or content. The values in `build.mr` come from a test run at its commit. This revisits ADR-0071, which left dual execution of the legacy system out: it stays out of the runtime, and is the member's to do where the legacy system can run or is recorded.
2. **One reader for the report.** `memberTestReportOf` in `@kintsugi/domain` keeps only well-formed values (integer counts, rule ids, at most 500); the API uses it for what it shows of a member's record, and the review run carries the report of the reviewed `build.mr` in `scope.mr.tests`.
3. **A deterministic parity step in the review.** `parity.py` (plugin `modernize`, after `check_code_review.py`) reads, for every rule of every reviewed unit:
   - the files the merge request changes that name the rule, at the reviewed commit: code files and test files (by path, the rule of `classifyItem`). Static: nothing is run;
   - what the member reported of the rule's tests at that commit;
   - the reviewer's blockers and majors that name the rule.

   A rule's level is the strongest that holds, a contradiction first: `failed` (the member reported a failing test), `disputed` (a blocker or major names it), `reported` (named in code and tests, and reported passing), `static` (named in code and tests), `untested` (in code only), `missing`. A unit's parity is `reported` only when every rule is; `partial` when some rule is at least `static`; `none` otherwise; `unknown` when the changed files are not known. The member's legacy comparison is kept as reported.
4. **The review shows it, and says what it is.** `_build/review.md` gains `parity` and the count of rules per level in its front matter, and a section *Parity with the rules*: the verdict, the member's run, the legacy comparison, and one row per rule (code, tests, member's run, reviewer). It states that Kintsugi ran nothing, that a `reported` level rests on the member's word and a `static` one on names in files. The description of the pull request shows the parity of each unit.

## Consequences

- A reader sees which rules the merge request is silent on, which are only claimed, and which a reviewer disputes, before merging.
- `reported` is the highest level Kintsugi can give: nothing here proves the tests ran. A level observed by a continuous integration run, or by a run of Kintsugi itself, needs a source Kintsugi does not read today.
- A rule named in a comment and a test name can still be implemented wrongly; the reviewer's lenses and the member's legacy comparison are what catch that.
- Members with an older client record no per-rule results; their units read `static` at best, which is what the evidence supports.

## Not done

- Reading results from the merge request's CI (a forge integration) and recording an `observed` level.
- Showing the parity on the portal's Build page; it is in the review document and the pull request.
- Scoring the build and review stages in the known-answer eval ([ADR-0084](0084-known-answer-evaluation-of-the-built-in-plugins.md)).

## Alternatives considered

- **Have the runtime run the tests.** It would make `observed` possible, but runtime jobs run no target code ([ADR-0071](0071-members-build-runtime-reviews.md)) and have no toolchain or network for it.
- **Let the reviewer fill the matrix.** A model's reading of which files cover which rule is what the deterministic step can check exactly; the reviewer keeps judging whether the coverage is meaningful.
- **Lists in activity records.** The member bridge accepts scalar values only; a comma-separated string keeps the existing schema and every installed client.
