# ADR-0023: The runtime is a generic agent kernel; agents are data supplied per job

- Status: Accepted
- Date: 2026-10-10
- Decision register: D28
- Supersedes: ADR-0014 decision 3 ("built-in runtime agents are fixed in code"); ADR-0022
- Amends: ADR-0001 (agent list), ADR-0018 (upgrade gate)

## Context

ADR-0014 fixed eight built-in agents in `services/runtime`. ADR-0022 moved them into an
installation table (`admin.agent`), with the code catalog as a fallback. Either way, the engine
carried use-case knowledge: agent prompts and skills, a knowledge-base tool on every session,
rulebook, pack and capability fields in `JobSpec`, and an agent-id enum shared by the API and the
portal.

None of these agents has been validated in a pilot. Fixing them early locks the engine to guesses
and makes the runtime contract hard to reuse for other platform work. The engine needs to be
correct before any agent is: isolation, tool policy, limits, failure reporting and credentials.

## Decision

1. **`services/runtime` is a generic agent kernel.** It runs one agent job on pi and knows no
   agent, use case or Kintsugi domain concept (rulebook, packs, units, knowledge base, phases).
2. **An agent is data, supplied whole with each job.** `JobSpec.agent` is an `AgentDefinition`:
   `id`, `version`, `instructions` (the system prompt, used verbatim), optional inline `skills`,
   a tool allowlist, optional command-deny patterns and a thinking level. The runner stays
   stateless; it never looks an agent up.
3. **No agent ships with Kintsugi, in code or in seed data.** The code catalog, its skill assets
   and the `admin.agent` table are removed. Where agent definitions are stored and edited
   (an Agent Builder) is decided when the first agent is introduced.
4. **The job contract is use-case neutral:** agent, task prompt, model, read-only workspace paths,
   one output directory, limits (`timeoutSec`, `maxTurns`, `maxCostUsd`) and opaque `metadata`
   echoed for correlation. Higher layers (orchestrator) translate their concepts into these fields.
5. **The kernel locks pi down:**
   - no discovery from the checkout or the host: no context files, `.pi/` resources, settings
     files, packages, `SYSTEM.md`, MCP, codemode or tool search;
   - provider, models and credentials are registered in memory, never written to disk;
   - only tools in the agent's allowlist are created; file tools are confined to the job's
     read-only paths and output directory;
   - LLM errors, aborts, timeouts and exceeded limits end as `job.failed`, never `job.completed`.
6. **Tools are generic.** The kernel ships `read`, `ls`, `grep`, `find` (read-only) and
   `outputs_write` (output directory only). Further tools are added to the kernel's tool registry
   by code, with a review of their security boundary.
7. `RuntimeAgentId` in `@kintsugi/domain` becomes an open string; model bindings name agents by id.

## Consequences

- The runtime contract is small and testable without any agent; adding an agent is a data change
  plus, if needed, a new kernel tool.
- Agent model bindings can reference agents that do not exist yet; validation against a store
  comes with the store.
- The workspace template's sample pipeline still names agents; those names are placeholders until
  agents exist.
- ADR-0018's upgrade gate ("one job per built-in agent") becomes "the kernel smoke suite".
- Documentation describing the eight built-in agents (runtime agents reference, concepts,
  building blocks) describes intent, not shipped behaviour, until agents are reintroduced.
- Sandboxing stays required (ADR-0004, proposed ADR-0021): the kernel's path confinement and
  tool allowlist are defence in depth, not the isolation boundary.

## Alternatives considered

- **Keep the code catalog as defaults (ADR-0022).** Rejected: it keeps use-case content in the
  engine and two sources of truth for agent definitions.
- **Keep `admin.agent` empty.** Rejected: its schema would be designed before any agent or
  editor exists; it is easier to add the right table later.
