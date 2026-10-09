# Runtime agents

Runtime agents run on the Kintsugi Runtime (pi), one container per job.
- **Definitions**: [`runtime/agents/`](../../runtime/agents/), with skills in [`runtime/skills/`](../../runtime/skills/).
- **Defaults**: shipped in the `kintsugi-runner` image.
- **Overrides**: projects override them in the workspace repo's `.kintsugi/assets/`.

## Catalog

| Agent | Phase | Trigger | Input | Output |
|---|---|---|---|---|
| `knowledge-ingest` | P1, continuous | Repo registered, new commits | Code repos + workspace repo (read-only): source, xlsx/docx, KT transcripts, DB schemas | KB index in Postgres; generated AS-IS docs + gap candidates → `knowledge/` |
| `kb-assistant` | All | Portal chat, MCP `kb.ask` | Question + KB | Answer with citations (`repo@commit:path`, `path:line`) |
| `assessment` | P1 | Manual, `kb.ingest.completed` | Inventory, KB, operational data | `assessment/<app>/scorecard.md` (PR): draft scorecard, 7R recommendation, dependency risks |
| `wave-planner` | P1–P2 | Manual | Scorecards, dependency graph | Proposed wave plan (PR) |
| `to-be-analyst` | P2 | Manual | AS-IS KB, new requirements | Gap list, draft ADRs, co-existence options → `architecture/` (PR) |
| `task-planner` | P3–P4 | Manual, backlog change | TO-BE KB, backlog | Work item breakdown + task packs → `tasks/` (auto-commit) |
| `gate-reviewer` | P4–P5 | `pr.opened`, `pr.synchronized` | PR diff, task pack, KB, CI results | PR comments, gate checklist, traceability links; record → `reviews/` |
| `insight` | All | Schedule | Events, telemetry, tracker | Progress reports, AI metrics, risks |

## `agent.yaml` (draft schema)

| Field | Type | Description |
|---|---|---|
| `id` | string | One of the agent ids above (`RuntimeAgentId`) |
| `version` | semver | Version recorded on every job and output |
| `phase` | `Phase` | Pipeline phase the agent belongs to |
| `description` | string | One-line purpose |
| `model.provider` / `model.id` / `model.thinking` | string | Default binding; admins rebind per project ([LLM configuration](../architecture/concepts/llm-configuration.md)) |
| `skills` | string[] | Skill names from `runtime/skills/` or project overrides |
| `tools.allow` | string[] | pi built-ins (`read`, `grep`, `find`, `ls`, …) and Kintsugi tools (`kb.search`, `kb.graph`, `inventory.get`, `task.get`, `write-out`, `pr.comment`, `gate.report`) |
| `network` | `default` | `kintsugi-app` + `egress-proxy` (LLM hosts) only |
| `inputs` | string[] | `repo`, `pull-request`, `document`, `kb-query` |
| `outputs` | list | `pr-comment`, or `{ path, commit: pull-request \| auto }` in the workspace repo |
| `triggers` | list | `manual`, `{ event: <domain event> }`, schedules |
| `budget.max_cost_usd` / `budget.timeout_sec` | number | Enforced per job |
| `review.approver_role` | `Role` | Who must approve the result (agents never approve) |
| `eval.set` / `eval.pass_threshold` | string / number | Eval suite gating upgrades and changes |

Contract types: `JobSpec`, `JobEvent`, `JobOutputRule` in [`packages/runtime-sdk`](../../packages/runtime-sdk/src/index.ts).

## Kintsugi tools available to runtime agents

| Tool | Access | Description |
|---|---|---|
| `kb.search` | Read | Semantic search over the project's KB |
| `kb.graph` | Read | Entity / dependency graph queries |
| `inventory.get` | Read | Application inventory record |
| `task.get` | Read | Task pack and work item details |
| `write-out` | Write `/out` only | Write an output file for the worker to commit |
| `pr.comment` | Write (via gateway) | Post a review comment on a member's PR |
| `gate.report` | Write (via gateway) | Report a gate checklist result |
