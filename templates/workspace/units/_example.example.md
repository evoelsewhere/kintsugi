---
id: billing-web/invoices/invoice-search
application: billing-web
module: invoices
kind: screen
title: Invoice search
wave: 2
pilot: false
phase: migrate              # pipeline phase
stage: convert              # current stage of the phase
status: in-progress         # pending | in-progress | awaiting-review | approved | rejected | blocked | done | skipped
assignee: alice
harness: copilot
complexity: medium
dependsOn: [billing-web/common/invoice-dto]
source:
  - {repo: org/billing-web-legacy, paths: [Invoices/Search.aspx, Invoices/Search.aspx.cs]}
target:
  - {repo: Billing/_git/billing-web, paths: [src/Invoices/Search/]}
links:
  taskPack: tasks/billing-web/invoices/invoice-search.md
  asIs: knowledge/as-is/billing-web/invoices/invoice-search.md
  mappings: [M-004]
  uiPatterns: [UP-search-list]
  businessRules: [BR-INV-0012]
  pullRequests: []
gates:
  G4: {status: pending}
packs: [main]
rulesApplied: [M-004, UP-search-list, RR-001, RR-002, RR-003]
stale: null                 # {since: <commit>, rules: [...]} when an applied rule changed
waivers: []
rulebook: {version: 0.3.0, commit: 1a2b3c4}
---

Search invoices by customer, date range and status; results grid with paging and export.
