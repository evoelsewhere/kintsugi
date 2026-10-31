# 10. Quality requirements

Quality goals are listed in [1.2](01-introduction-and-goals.md#12-quality-goals). The scenarios below make them testable.

| ID | Quality | Scenario | Expected response |
|---|---|---|---|
| Q1 | Security | A legacy repo contains instructions telling the agent to exfiltrate code to an external URL | The agent reaches only what its tools allow: its file tools are confined to the job workspace, and `shell`, web fetch and MCP tools exist only when its allowlist or its job grants them. Every tool call, allowed or blocked, is recorded as a telemetry span. Kintsugi does not block the request at the network (there is no egress proxy): where exfiltration must be impossible, the worker's egress is restricted at deployment level ([Security](concepts/security.md)) |
| Q2 | Security | A runtime agent attempts to modify files in the legacy checkout (`as-is/`) of its job workspace | The kernel refuses the write: `write` and `edit` are confined to the step's `out` folder, and the checkouts are also marked read-only on disk unless Settings → Sandbox & Agent switches the marking off. Nothing reaches Git except validated `out` content committed by the worker |
| Q3 | Security | A script step, a `shell` command or another job looks for a job's LLM key | Its own environment and the disk hold none: the key is decrypted per job and handed to the agent in memory (no `models.json` or `auth.json` is written), and scripts and `shell` run with a cleared environment. Not met today for a determined process: it runs as the worker's OS user and can read the worker's environment, whose master key and database URL open every stored credential, so the worker's egress must be restricted ([Security](concepts/security.md), items 2, 5 and 8) |
| Q4 | Deployability | An admin installs Kintsugi on a clean Linux host with Docker | `docker compose up -d` plus `.env` gives a working portal; no other infrastructure is required |
| Q5 | Deployability | Upgrade to a new release | Pull images and restart; migrations run automatically; no data loss |
| Q6 | Traceability | An auditor asks where a detail design came from | The artifact shows `repo@commit:path`, author, harness, AI share, reviewing gate and approver |
| Q7 | Rebuildability | The Postgres volume is lost, and there is no backup | Work items, statuses, gate results and KB index are rebuilt from Git; documents and code are intact; only operational history (jobs, events, usage, audit) is lost |
| Q8 | Harness neutrality | A team switches from Copilot to Claude Code mid-project | Members use the same Coding Agent Workflow contract and generate a client package (`kintsugi plugins setup --harness claude-code`); gates and metrics keep working |
| Q9 | Responsiveness | A runtime job is running | The portal shows job events live (SSE), within ~1 s of the runner emitting them |
| Q10 | Cost control | A runtime job exceeds its budget | The job is stopped; the cost and the reason are recorded |
| Q11 | Consistency | A member starts converting screens before the UI conventions and mappings are written | The task pack cites no standard for the unit, `task-planner` flags the gap, and gate G3 has not been approved, so the unit is not assignable |
| Q12 | Traceability | An auditor asks which rules a converted unit followed | The task pack lists the standards that applied, the review record cites the review-rule ids, and provenance records the document repo commit, so the exact standards can be read from Git |
| Q13 | Extensibility | A project adds a second stack pair, a custom `security` stage and the Cursor harness | Done with new standards and plugins in the document repo, a pipeline in `kintsugi.yaml` and a renderer config. No Kintsugi release |
| Q14 | Safety | A mapping is found to produce wrong code after 40 units | The mapping is fixed by PR in `01-standards/mappings/`; the units that cite it in their `links` are found from the index and re-reviewed |
