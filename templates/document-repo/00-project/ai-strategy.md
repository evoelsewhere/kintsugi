---
title: "AI strategy"
status: "draft"
version: 1
---
# AI strategy

Where AI agents apply across the migration, where people always decide, and how the program measures what the agents deliver. The rules about data and approvals are in [ai-usage-policy.md](ai-usage-policy.md).

## Principles

| Id | Principle | Meaning in practice |
| --- | --- | --- |
| AI-01 | People decide, agents propose | An agent's output arrives as a pull request or a note; nothing it writes is final until a person approves it. |
| AI-02 | Evidence over fluency | A statement an agent makes cites the source it read (file and lines); an uncited statement is a question, not a finding. |
| AI-03 | Same method every time | The agents, their instructions and the templates are versioned data, so a rerun can be explained. |

## Where AI applies

| Phase | Work | Performed by | A person decides |
| --- | --- | --- | --- |
| Assess | inventory, topology, catalog, assessment | runtime agents | which applications and items go forward |
| Understand | specification, business rules, data objects, security findings | runtime agents | each rule verdict (confirmed, clarify, rejected) |
| Design | the unit design sets, their review | runtime agents | acceptance of the design pull request |
| Build | implementation and tests of a unit | the member's harness | the code review and merge |
| Review | review of the merge request against the design and rules | runtime agents | the merge |

## Where AI does not apply

| Activity | Why |
| --- | --- |
| <!-- scope and priority decisions --> | <!-- accountability sits with the sponsor --> |
| <!-- approving a gate --> | <!-- a gate is a human decision --> |

## Automation target

| Measure | Baseline | Target | Source |
| --- | --- | --- | --- |
| Share of unit documents drafted by an agent and accepted with edits under 20% | <!-- --> | <!-- --> | <!-- the portal --> |
| Rule verdicts that match the first extraction | <!-- --> | <!-- --> | <!-- the review --> |

The KPI baseline is in [kpi-baseline.md](kpi-baseline.md).

## Tools and models

| Tool | Used for | Approved models | Owner |
| --- | --- | --- | --- |
| Kintsugi runtime | the understanding and design phases, the review | <!-- providers configured in the portal --> | <!-- team --> |
| Members' harnesses | implementation and tests | <!-- Claude Code, Copilot, Codex --> | <!-- team --> |

## Skills and training

<!-- Who learns what, and by when: reading an agent's evidence, writing a rule verdict, reviewing a design. -->
