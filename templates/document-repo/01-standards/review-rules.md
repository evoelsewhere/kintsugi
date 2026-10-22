# Review rules

Rules that reviewers (human and runtime) enforce. Each rule has a stable id that findings cite. `block` rules fail the review; `warn` rules are only reported. TODO: replace the starter rules below with the project's own.

## RR-001 · Code follows the target layering (block)
Dependencies follow the direction defined in `conventions/target.md`. Any reference from a lower layer to a higher one is rejected.

## RR-002 · UI uses only UI-kit components (block)
Screens are assembled only from the UI kit of the target repos. Custom components or styles outside the design tokens are rejected.

## RR-003 · Every business rule is implemented or explicitly dropped (block)
Each business rule listed in the unit's AS-IS document is either implemented, with a reference in the pull request, or dropped through an ADR.
