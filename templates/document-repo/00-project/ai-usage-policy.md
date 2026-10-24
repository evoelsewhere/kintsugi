---
title: "AI usage policy"
status: "draft"
version: 1
---
# AI usage policy

What AI may do in this program: which data it may see, which repositories it may write to, which outputs need a person's approval, and how its use is audited. It applies to the Kintsugi runtime and to every member's harness.

## Data

| Class | May an agent read it | May it leave the organisation's boundary (to a model provider) | Handling |
| --- | --- | --- | --- |
| public | yes | yes | none |
| internal | yes | <!-- yes / no, and under which provider terms --> | <!-- --> |
| confidential | <!-- yes, masked --> | no | masked in prompts and logs |
| restricted | no | no | never given to an agent; records are stored encrypted and read by people only |

Classes are defined in `../02-architecture/data-architecture.md`. Secrets are never given to an agent.

## What agents may do

| Action | Allowed | Condition |
| --- | --- | --- |
| Read the legacy code and the standards | yes | read-only checkouts at a pinned commit |
| Write a document | yes | through a pull request to the document repo |
| Write target code | members' harnesses only | on a branch, through a merge request |
| Run commands | <!-- scripts and tests only --> | in the job workspace, without credentials |
| Call external services | <!-- no / allowlist --> | <!-- --> |

## Approvals

| Output | Approved by | Before |
| --- | --- | --- |
| Business rule verdicts | the subject-matter expert | the rules are used by a design |
| A unit's design | the reviewer named in the RACI | the unit is built |
| Code and tests | a reviewer other than the author | merge |
| Any change to a standard | the architecture lead | merge |

## Audit

| Record | Kept by | For |
| --- | --- | --- |
| Every runtime job: agent, version, model, inputs, outputs, tool calls | the Kintsugi portal | <!-- period --> |
| Member activity: tokens, time, harness | the Kintsugi portal | <!-- period --> |
| Commit trailers naming the job and the agent | the document repo and the code repositories | the life of the repository |

## Responsibilities

A person is responsible for what they merge, whoever or whatever drafted it. Report an agent output that exposed data it should not have seen to <!-- contact --> the same day.

## Review

This policy is reviewed every <!-- period --> and after any incident.
