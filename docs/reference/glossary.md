# Glossary

| Term | Meaning |
|---|---|
| **7R** | Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Rebuild, Repurchase: the transformation strategies for an application |
| **AS-IS / TO-BE KB** | Knowledge base of the current / target system. Sources are in Git; the index (vector + graph) is in Postgres |
| **Code repo** | A Git repo holding application source (as-is or to-be). A project usually has many, possibly on different Git servers |
| **Digital worker** | An AI role such as reverse design, version upgrade or unit-test generation. In Kintsugi it is a skill pack plus a task-pack template, run in a member's harness, with runtime agents preparing and reviewing the work |
| **Gate** | Quality / approval checkpoint: G0–G6 per phase, plus per-work-item gates |
| **Harness** | An environment that runs an AI agent (pi, Claude Code, GitHub Copilot, Codex…) |
| **Installation** | One self-hosted Kintsugi instance (Docker Compose), serving one organization |
| **Kintsugi Runtime** | Kintsugi's agent environment, built on pi; one `kintsugi-runner` container per job |
| **Member harness** | The AI tool a member uses locally: Claude Code, GitHub Copilot, ChatGPT/Codex |
| **PAT** | Personal Access Token, used by the CLI and MCP clients |
| **Runtime agent** | A platform agent executed by the runtime (assessment, task-planner, gate-reviewer…) |
| **Scorecard** | Weighted assessment of an application across business, technical, feasibility, cost and risk criteria |
| **Skill pack** | Skills in the Agent Skills format (`SKILL.md`), usable across harnesses |
| **Task pack** | Context for one work item (spec, AS-IS excerpts from the KB, rules, acceptance criteria, suggested skills) for a member's harness |
| **Wave** | A group of applications or work items migrated together, by pattern |
| **Work item** | Unit of migration (feature / screen / module / API / DB object) that moves through stages |
| **Workspace repo** | The project's Git repo for configuration (`kintsugi.yaml`), inventory, assessment, ADRs, AS-IS/TO-BE docs, task packs, deliverables |
