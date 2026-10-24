---
title: "Batch job"
status: "draft"
version: 1
---
# Batch job

- **Recognize in legacy**: a scheduled program or job step that reads a file or table, processes records in a loop and writes a file or table.
- **Target template**: <!-- the batch framework's job and step -->.
- **Behaviours to preserve**: record order, commit interval, restart point after a failure, the exact content of the output file.
- **Allowed deviations**: only those covered by an ADR in `../../02-architecture/adr/`.

## Construct mapping

| Legacy | Target | Notes |
| --- | --- | --- |
| <!-- job control statement --> | <!-- job definition --> | <!-- parameters, schedule --> |
| <!-- checkpoint or restart file --> | <!-- job repository --> | <!-- what a restart resumes --> |
| <!-- sort step --> | <!-- ordered query --> | <!-- same key order --> |
| <!-- return code --> | <!-- exit status and alert --> | <!-- which code means what --> |
