---
kind: batch-job
version: 1
---
# Detail design: batch jobs

A batch job is described by when it runs, what it processes in which order, and how it restarts. Its logic template adds the schedule, the steps and the restart rules.

## Instructions

State the schedule and the volume the job is sized for, the commit unit of every step, and exactly what a restart does after a failure at each step. Never describe a step as "process the data": name the tables, files and fields.
