---
kind: "report"
version: 1
---
# Specification profile: report

The sections an AS-IS specification of a document or an extract produced for people has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Parameters and selection | what a person or a schedule chooses before it runs, with defaults and checks | parameter screens, parameter cards, request objects |
| Data sources | the tables, files and interfaces it reads, with the selection and the order | queries, reads, joins |
| Layout | the columns, groupings, headers, footers and totals in the order they appear | report definitions, templates, print formats |
| Calculations | every computed figure, its formula and its rounding, with the rule id when it is catalogued | calculation code, report expressions |
| Output format and destination | the format, the medium and where it goes, and who receives it | export code, distribution settings |
| Frequency and audience | when it is produced and for whom, when the code or configuration says | schedules, recipients, authorization |

## Instructions

Describe the report so that its figures can be reproduced from the data. A calculation the code does not make visible (done by the database or a report engine) is a gap.

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
