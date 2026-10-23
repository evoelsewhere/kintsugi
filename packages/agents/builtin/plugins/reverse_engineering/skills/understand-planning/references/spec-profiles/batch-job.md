---
kind: "batch-job"
version: 1
---
# Specification profile: batch-job

The sections an AS-IS specification of unattended work started by a schedule or an operator has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Trigger and schedule | when and by what it starts, its calendar, and the conditions for running | scheduler definitions, job headers, cron entries, operator procedures |
| Inputs and outputs | the files, tables and datasets it reads and writes, with their layout by data object id and their volumes where known | file definitions, queries, allocations |
| Steps | the steps in order: what each does, the program it runs (a catalog item id when it is in the catalog), its condition and its return codes | job control, step definitions, the programs |
| Restart and recovery | what happens after a failure: restart points, checkpoints, what must be cleaned up by hand | restart parameters, checkpoint logic, error branches |
| Volumes and windows | how much it processes, how long it runs and the window it must finish in, when the code or configuration says | limits, commit intervals, window definitions |
| Predecessors and successors | the jobs that must finish before it and the ones that wait for it | scheduler dependencies, trigger files, job chains |

## Instructions

A mainframe job is the job control plus the programs its steps run: describe the steps from the job and the main logic of each program from its own item. Never repeat a program's rules; refer to its item.

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
