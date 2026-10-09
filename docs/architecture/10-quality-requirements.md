# 10. Quality requirements

Quality goals are listed in [1.2](01-introduction-and-goals.md#12-quality-goals). The scenarios below make them testable.

| ID | Quality | Scenario | Expected response |
|---|---|---|---|
| Q1 | Security | A legacy repo contains instructions telling the agent to exfiltrate code to an external URL | The runner has no route except to `kintsugi-app` and LLM hosts. The request fails at the egress proxy. Blocked tool calls are audited |
| Q2 | Security | A runtime agent attempts to modify files under `/src` | The write fails (read-only mount). Nothing reaches Git except validated `/out` content committed by the worker |
| Q3 | Security | A job's LLM key is inspected inside another job's container | Not possible: each container only receives the credentials of its own provider, as env, and is removed after the job |
| Q4 | Deployability | An admin installs Kintsugi on a clean Linux host with Docker | `docker compose up -d` plus `.env` gives a working portal; no other infrastructure is required |
| Q5 | Deployability | Upgrade to a new release | Pull images and restart; migrations run automatically; no data loss |
| Q6 | Traceability | An auditor asks where a detail design came from | The artifact shows `repo@commit:path`, author, harness, AI share, reviewing gate and approver |
| Q7 | Rebuildability | The Postgres volume is lost, and there is no backup | Work items, statuses, gate results, rulebook and KB index are rebuilt from Git; documents and code are intact; only operational history (jobs, events, usage, audit) is lost |
| Q8 | Harness neutrality | A team switches from Copilot to Claude Code mid-project | Members install the same plugins from the project marketplace (`kintsugi plugins setup --harness claude-code`); gates and metrics keep working |
| Q9 | Responsiveness | A runtime job is running | The portal shows job events live (SSE), within ~1 s of the runner emitting them |
| Q10 | Cost control | A runtime job exceeds its budget | The job is stopped; the cost and the reason are recorded |
| Q11 | Consistency | A member starts converting screens while `conventions` and `mapping` are still at `template` | `task-planner` refuses to create task packs for those units and names the missing capabilities; the readiness board shows what blocks the stage |
| Q12 | Traceability | An auditor asks which rules a converted unit followed | The unit's `rulesApplied`, the task pack, the review record and the commit trailers carry the rule IDs and `rulebook <version>@<commit>`; the resolved view shows which layer each rule came from |
| Q13 | Extensibility | A project adds a second stack pair, a custom `security` stage and the Cursor harness | Done with a new pack, a pipeline edit, a custom capability and a renderer config. No Kintsugi release is needed |
| Q14 | Safety | A mapping rule is found to produce wrong code after 40 units | The owner sets the capability to `suspended`; dependent stages stop immediately; units that applied the rule are marked `stale` for re-review |
| Q15 | Flexibility | Compare cannot be verified before wave 1 starts | A waiver with scope `kinds: [screen]` and an expiry lets wave 1 proceed; every run records the waiver; after expiry the stage blocks again |
