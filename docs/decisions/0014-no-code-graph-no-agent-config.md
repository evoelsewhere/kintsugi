# ADR-0014: No code graph or parsing, no unit-discovery config, built-in runtime agents fixed in code

- Status: Accepted
- Date: 2026-10-09
- Decision register: D13, D14, D28, D39, D42
- Supersedes: parts of ADR-0013 (decision 7 "per-language parsing and multi-source discovery", decision 8 "project runtime agents and runtime MCP"); ADR-0010 (KB graph tables)

## Context
Several mechanisms in the design add configuration surface and implementation cost without being necessary for the platform to work:
- **Code graph and parsing**: tree-sitter / SCIP indexes, structural extractors, entity/edge tables. Runtime agents can read source code directly with file tools and a text-searchable KB.
- **Unit discovery config** (`units.discovery` by glob / extractor / query) and complexity signals. Units can be declared by people or proposed by an agent.
- **Runtime agent configuration**: `agent.yaml` definitions in the repo, project runtime agents, per-agent tool allowlists, runtime MCP servers, extra agent instructions in the rulebook. This opens a large trust and support surface for little benefit.

## Decision
1. **No code graph, no language parsing.**
   - Kintsugi does not build ASTs, symbol indexes or dependency graphs.
   - The KB is text: documents and source files are chunked by plain text rules and embedded (pgvector), and runtime agents read files directly.
   - Removed: `parsing.*`, `extractors/`, `kb.graph`, `KbEntity` / `KbEdge`, complexity signals.
2. **No unit-discovery configuration.**
   - Units are files in `units/**` (ADR-0012).
   - They are either declared by people, or proposed by the `assessment` agent as a PR (inventory).
   - Packs keep only `units.kinds`, which `appliesTo` and scoped maturity use.
   - Dependencies between units (`dependsOn`) are written by people or proposed by agents. They are not computed.
3. **Built-in runtime agents are fixed in code.**
   - The agent set and each agent's prompt, skills, tools, policy and default budget are defined in `services/runtime`. They are versioned with the Kintsugi release, not configured in any repo.
   - Removed: `runtime/agents/*.yaml`, project runtime agents, `rulebook/agents/`, runtime MCP servers, `KINTSUGI_ALLOW_PROJECT_AGENTS`, and tool declarations in agent definitions.
4. **What stays configurable for the runtime:**
   - LLM provider and model binding per built-in agent (portal, ADR-0009);
   - per-installation job limits;
   - the rulebook content agents read as input (packs, rules, conventions, pipelines).

## Consequences
- **Smaller surface**: less to build, configure, secure and document. The extension trust boundary shrinks to runner images and harness transformer plugins.
- **Dependency ordering, impact analysis across code and complexity scoring** become agent judgments recorded in unit files, reviewed by people. They are not deterministic computations. Accepted for now; this can be revisited with an ADR if pilots show a need.
- **New agents or changes to agent behavior** require a Kintsugi release. Projects shape agent behavior only through the rulebook content the agents read.
