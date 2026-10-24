---
title: "Review rules"
status: "draft"
version: 1
---
# Review rules

Rules that reviewers (human and runtime) enforce. Each rule has a stable id that findings cite; an id never changes or is reused once it is merged. `block` rules fail the review, `warn` rules are only reported. The rules below are the starter's: replace them with the project's own.

## Index

| Id | Rule | Severity | Applies to | Checked by |
| --- | --- | --- | --- | --- |
| RR-001 | Code follows the target layering | block | code | review, build |
| RR-002 | UI uses only UI-kit components | block | screens | review |
| RR-003 | Every business rule is implemented or explicitly dropped | block | all units | review, test cases |
| RR-004 | Every error has a code and the message of the design | block | all units | review |
| RR-005 | No secret, credential or personal data in code, logs or tests | block | all units | scan, review |
| RR-006 | A design item is never renamed or reused | warn | designs | check_design |
| RR-007 | Tests state concrete input and expected output | warn | test cases | review |

## RR-001 · Code follows the target layering (block)

Dependencies follow the direction defined in `conventions/target.md`. Any reference from a lower layer to a higher one is rejected.

## RR-002 · UI uses only UI-kit components (block)

Screens are assembled only from the UI kit of the target repos. Custom components or styles outside the design tokens are rejected.

## RR-003 · Every business rule is implemented or explicitly dropped (block)

Each business rule listed in the unit's AS-IS document is either implemented, with a reference in the pull request, or dropped through an ADR.

## RR-004 · Every error has a code and the message of the design (block)

An error the unit can raise has the code `ERR-nnnn` and the text written in the unit's design. A message that is not in the design is a finding on the design or on the code, whichever is wrong.

## RR-005 · No secret, credential or personal data in code, logs or tests (block)

Secrets come from the secret store named in `../02-architecture/security.md`. Test data is synthetic or masked; a real customer record in a test is a finding.

## RR-006 · A design item is never renamed or reused (warn)

The ids of operations, events, steps and columns (`API-001`, `EVT-001`, `STEP-01`, `COL-01`) never change once written, so tests and code can cite them.

## RR-007 · Tests state concrete input and expected output (warn)

A test case names the data it needs, the exact input and the exact expected result; "a valid customer" is not an input.

## How a finding cites a rule

A finding names the rule id, the file and line, and what to change: `RR-003 src/invoice/Search.java:48 rule RULE-invoice-amount-001 is not implemented`.
