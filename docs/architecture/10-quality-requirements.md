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
| Q7 | Rebuildability | The Postgres volume is lost, and there is no backup | The KB index is rebuilt from Git; documents and code are intact; only operational history is lost |
| Q8 | Harness neutrality | A team switches from Copilot to Claude Code mid-project | Task packs and skills are re-rendered with `kintsugi assets pull`; gates and metrics keep working |
| Q9 | Responsiveness | A runtime job is running | The portal shows job events live (SSE), within ~1 s of the runner emitting them |
| Q10 | Cost control | A runtime job exceeds its budget | The job is stopped; the cost and the reason are recorded |
