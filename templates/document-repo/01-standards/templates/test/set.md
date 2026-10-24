---
id: test
title: Test cases
version: 2
needs: []
---
# Test cases

The cases that prove the unit behaves as the legacy system does: one case per business rule at least, with concrete preconditions, input and expected result, at the level that runs it (unit, integration, system), plus the boundary and failure cases the rules imply, and the data the cases need. Written from the unit's AS-IS specification and rules, and from its design when it has one (the ids of its operations, events, steps or columns go in the `Target` column), before the unit is coded. Applies to every unit kind. Replace this set with your project's own format.

| Path | Template | Required |
| --- | --- | --- |
| cases.md | cases.md | yes |
| test-data.md | test-data.md | no |

## Instructions

Write cases a builder can turn into an automated test without asking: concrete values, never "a valid customer". State the precondition (the data that must exist), the exact input and the exact expected result, including the message or status. Cover every business rule at least once, then the boundaries of every limit it states and the failures it names. Write `test-data.md` when the cases need data that does not exist in the target test environment.
