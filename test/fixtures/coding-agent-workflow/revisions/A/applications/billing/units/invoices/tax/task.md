# Task: implement invoice tax calculation

## Objective

Implement the approved tax calculation for the billing invoice service. Use integer minor units and the approved rounding behavior in the cited designs. Do not change the read-only legacy source repository.

## Requested activity

Implementation.

## Acceptance criteria

- Tax is calculated from the approved tax rate and subtotal.
- Rounding follows the detailed design and is deterministic.
- Unit and integration tests cover zero, fractional and boundary tax values.
- The code change is limited to the billing-api target paths in unit.md.
- The design deliverable records any implementation detail that changes the approved design.

## Required inputs

- Approved basic design: applications/billing/to-be/design.md
- Approved detailed design: applications/billing/units/invoices/tax/design.md
- Approved conventions: standards/conventions/typescript.md
- Review rules: standards/review-rules.md

## Required deliverables

- code: billing-api, src/billing/tax
- design: project-docs, applications/billing/units/invoices/tax/design.md

## Open decisions

None in revision A. If a required source changes or becomes unapproved, stop and ask the task owner to resolve the blocker.
