# Runtime agents

Runtime agents are Kintsugi's built-in agents. They run on the Kintsugi Runtime (pi), one container per job.

- **Fixed in code** ([ADR-0014](../decisions/0014-no-code-graph-no-agent-config.md)):
  - The agent set, and each agent's prompt, skills, tools, policy and default budget, are defined in [`services/runtime`](../../services/runtime/README.md) and versioned with the Kintsugi release.
  - There is no agent configuration file in any repo, and projects cannot add agents.
- **What a project controls**:
  - the **model** each agent uses (Admin → LLM Providers → agent bindings, [LLM configuration](../architecture/concepts/llm-configuration.md));
  - the **rulebook content** agents read for the job's units: packs, overrides, vendored content, pipelines.
- **How agents read code**: directly, with file tools on the read-only checkout, plus `kb.search`. There is no code graph or parser.
- **Readiness**: the capabilities a job needs come from the **pipeline stage** it runs (`requires` in `pipelines/*.yaml`). The worker checks every layer providing each capability for each unit:
  - `ready` passes; `draft` passes only for pilot units;
  - otherwise an unexpired waiver is needed;
  - `suspended` always blocks.

  If the check fails, the job is refused and the missing capability and layer are named.

## Catalog

| Agent | Phase | Trigger | Input | Typical capabilities | Output |
|---|---|---|---|---|---|
| `knowledge-ingest` | P1, continuous | Repo registered, new commits | Source and target repos + workspace repo (read-only): source files, xlsx/docx, KT transcripts, DB schema exports | `understand` | Text chunks + embeddings in Postgres; generated AS-IS docs + gap candidates → `knowledge/` |
| `kb-assistant` | All | Portal chat, MCP `kb.ask` | Question + KB + source files | — | Answer with citations (`repo@commit:path`, `path:line`) |
| `assessment` | P1 | Manual, `kb.ingest.completed` | `kintsugi.yaml`, unit files, KB, source | `understand` | `assessment/<app>/scorecard.md` + proposed unit files (`units/<app>/**`, incl. `dependsOn`) as a PR |
| `wave-planner` | P1–P2 | Manual | Scorecards, unit files (`dependsOn`, `kind`) | `understand` | Proposed wave plan (PR) |
| `to-be-analyst` | P2 | Manual | AS-IS KB, new requirements, target base | — (helps shape `conventions`) | Gap list, draft ADRs, co-existence options, draft `conventions/target.md` → PR |
| `task-planner` | P3–P4 | Pipeline stage, backlog change | TO-BE KB, unit file, resolved rules | `conventions`, `mapping`, `convert` | Task packs → `tasks/` (auto-commit) |
| `gate-reviewer` | P4–P5 | `pr.opened`, `pr.synchronized` | PR diff, task pack, resolved rules, KB, CI results | `review`, `conventions` | PR comments citing rule IDs, gate checklist; record → `reviews/` |
| `insight` | All | Schedule | Events, telemetry, tracker, unit files | — | Progress reports, AI metrics, risks, rulebook readiness |

The capabilities above are what the built-in pipeline templates ask for. What a project actually requires is whatever its own pipeline definitions declare.

## Tools (fixed per agent, for reference)

| Tool | Access | Description |
|---|---|---|
| `read`, `grep`, `find`, `ls` | Read `/src` | pi built-ins on the read-only checkout |
| `kb.search` | Read | Semantic / full-text search over the project's KB |
| `task.get` | Read | Task pack and unit details |
| `write-out` | Write `/out` only | Write an output file for the worker to commit |
| `pr.comment` | Write (via gateway) | Post a review comment on a member's PR |
| `gate.report` | Write (via gateway) | Report a gate checklist result |

Contract types: `JobSpec`, `JobEvent`, `JobOutputRule` in [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts).
