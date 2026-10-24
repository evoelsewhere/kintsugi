---
id: batch-job
title: Batch job design
version: 1
needs: []
---
# Batch job design

How a batch job of the target system runs: when and with what it starts, what it reads and writes, its steps in order with their commit units, how it restarts after a failure and how it is operated. Written from the job's AS-IS specification and rules before it is coded, precise enough that the code can be generated from it. Only for units of kind `batch-job` (the files come from the profile `batch-job/`). Replace this set with your project's own format.
