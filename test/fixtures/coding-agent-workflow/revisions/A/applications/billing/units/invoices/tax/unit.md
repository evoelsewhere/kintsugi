---
id: billing/invoices/tax
application: billing
module: invoices
kind: calculation
title: Invoice tax calculation
phase: migrate
stage: implement
status: in-progress
assignee: reader-a
harness: claude-code
complexity: low
source:
  - repo: legacy-ledger
    paths:
      - src/legacy/tax
target:
  - repo: billing-api
    paths:
      - src/billing/tax
links:
  taskPack: applications/billing/units/invoices/tax/task.md
gates:
  G3:
    status: approved
    by: maintainer
    at: 2026-10-18
    review: applications/billing/units/invoices/tax/reviews/G3.md
  G4:
    status: pending
    review: applications/billing/units/invoices/tax/reviews/G4.md
---

# Unit

Implement the approved invoice tax behavior for this synthetic billing service.
