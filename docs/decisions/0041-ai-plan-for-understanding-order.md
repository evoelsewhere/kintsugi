# ADR-0041: An AI plan for what to understand next, from the relationships between catalog items

- Status: Accepted (the plan is `understanding/plan.md` and the item graph is computed from the catalog: [ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md))
- Date: 2026-10-20
- Decision register: D57

## Context
[ADR-0033](0033-assess-catalog-understand-selection.md) made the catalog the menu: a person selects items and runs `understand` on them. On a real estate (27 items, 10 modules in the first one) the menu is not enough to choose from. The order matters: an AS-IS specification cites what its item calls and what calls it, and items that depend on each other read best in one run. A size-and-complexity ranking in the portal ignores all of that, and a person has to rebuild the picture from the topology by hand.

`assess` already produces what is needed to reason about order: `topology.json` (edges between leaves), the catalog (which leaves belong to which item) and `ASSESSMENT.md` (risks, recommended pattern). `scope_items.py` already resolves leaf edges to item-to-item dependencies, but only for the items of a selection.

## Decision
A third runtime stage, `plan-understand`, built the way the plugin architecture builds a stage (ADR-0027, ADR-0035): a **command**, the **agent** it starts and the **skill** that holds the method, all in the built-in `reverse_engineering` plugin, with the stage plan in the orchestrator (ADR-0023) and a test that keeps the command's declared flow equal to the plan:

- command `commands/modernize-plan-understand.md` (stage id `plan-understand`): `metadata.flow`, `reads`, `writes`, `agents`, `skills`;
- agent `agents/understand-planner.md`, with the full runtime tool set (ADR-0040) and the skill `understand-planning`;
- skill `skills/understand-planning/` (`SKILL.md` and `references/item-graph.md`): how to read the graph, the rules that decide an order, how to write a rationale;
- scripts `scripts/plan_graph.py` and `scripts/check_plan.py`.

The stage has three steps:

1. `plan_graph.py` computes the item graph for the whole catalog from the topology: dependencies between items (kinds of calls, how many), data stores, fan-in and fan-out, depth (0 = depends on no other item) and cycles (strongly connected components), the asset class of each item and whether it is understood already. No code is read.
2. An `understand-planner` job reads the graph and `ASSESSMENT.md` under the `understand-planning` skill and returns batches: a title, the items, a rationale citing graph and assessment facts and a risk, plus what it left out and why. The task carries only this run's facts and limits (paths, schema, at most 8 items per batch); the method (cycles stay together, foundations early, a callee with its callers, assessment risks early) is the skill's.
3. `check_plan.py` decides what stands. It drops items that are unknown, understood, test or generated code, or repeated, caps batch size, and adds what only the graph can say: size, high-complexity count, cohesion (calls inside the batch over calls to other items) and the not-yet-understood items a batch depends on. A plan with no batch left fails the script step, which gives the agent the reason once (the existing repair loop).

`applications/<app>/assessment/understand/plan.json` is the only published file. It is **advice that every run replaces**, so it is an auto-commit path (default `autoCommitPaths`, [ADR-0019](0019-workspace-repo-write-path.md)): no pull request to review. The graph and the draft are intermediate.

`GET /api/projects/:id/applications/:appId/understand/plan` returns the plan with the current status of its items and `stale` when the catalog's source commit differs from the one planned at. The portal shows the batches above the catalog (reason, size, self-containedness, dependencies still open) and selects a batch with one click; it asks for a plan with the stage run endpoint. Without a plan, the "Quick pick" button remains: a size and complexity heuristic that does not use relationships.

**Why a dedicated agent.** The kernel puts a skill's `SKILL.md` into the system prompt of every job of an agent that lists it. `legacy-analyst` runs once per item in `understand`; giving it the planning skill would add it to every specification job. A separate agent keeps that prompt as it was. The cost is one more agent to bind: **an `understand-planner` model binding must exist (Settings → Providers → Agent model bindings, all projects)** or the planning job fails with "No model is bound to agent"; the portal says so before the button is used (the agent problems of the stage).

The asset class (`classifyItem` in `@kintsugi/domain`, mirrored in `plan_graph.py`) keeps test and generated code out of plans.

## Consequences
- The model sees a compact graph, not the code: a plan costs one agent job, not a read of the application. Its quality is bounded by the topology: an extraction that finds no edges gives a plan by size and assessment alone (`stats.topology` and `edges` are in the graph for anyone checking).
- The agent proposes and the script disposes: a plan never names an item that cannot be run. Understanding of an item is not blocked by the plan: a person may still select anything.
- Plans age. `stale` covers reassessment; a plan after several merged understand runs still lists understood items, which the portal shows as done and skips.
- The classification regex lives twice (TypeScript and Python); a test on each side pins the cases. Follow-up: one source if a third consumer appears.
- Not done: running the first batches automatically, learning from earlier plans, and using the understood specifications' own dependencies (`trace.json`) to refine later plans.

## Alternatives considered
- **A heuristic in the portal only** (complexity, size, fan-in): cheap and deterministic, kept as "Quick pick", but it cannot weigh the assessment or explain a grouping.
- **Letting the agent read the code to find relationships**: costly and unneeded: the topology already has the edges.
- **Committing the plan through a pull request**: it is advice a later run replaces; a review of it would be noise.
