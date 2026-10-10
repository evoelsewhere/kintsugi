# ADR-0022: Agents are installation data — built-in and custom, managed in the portal

- Status: Superseded by ADR-0023
- Date: 2026-10-10
- Decision register: amends ADR-0014 (D28)

## Context

ADR-0014 fixed the built-in runtime agents in code: the platform ships eight agents (knowledge,
assessment, planning, review, insight) and projects cannot configure agents in their repos. That is
still the right default for **repos** — but it left the installation with no way to see or adjust
what its agents do (prompt, tools, budget) and no way to add new agents for specific platform work.
Product direction: an **Agent Builder** where the installation defines and maintains agents.

## Decision

- Agents live in the installation database (`admin.agent`) with two types:
  - **builtin** — seeded from the Kintsugi release (the former code catalog becomes seed data);
    editable per installation (prompt, tools, budget), versioned with the release;
  - **custom** — created by installation admins for their own platform work.
- The **code catalog remains as fallback defaults** (dev without DB, seeds, validation) — the
  runtime resolves `JobSpec.definition` first, then the code catalog for built-ins.
- The **launcher** resolves the agent definition from the database and embeds it into the `JobSpec`
  (like provider credentials), so the runner stays stateless and needs no DB access.
- Model binding stays separate (`AgentModelBinding`, ADR-0009).
- **Repos still carry no agent configuration** (ADR-0014 stands for projects): what projects control
  is the rulebook content agents read. Agents are installation-level platform data.

## Consequences

- The portal gets an Agent Builder (list, create, edit prompt/tools/thinking/budget, enable).
- `JobSpec.agent.id` becomes an open string; `RUNTIME_AGENTS` remains the well-known builtin set.
- Provenance keeps `Kintsugi-Agent: <id>@<version>` and now records the installation's agent version
  rather than the release version alone.
- Upgrades must reconcile seeded builtin rows with the code seeds (drift report), never overwrite
  custom agents.
