# ADR-0068: Generate the design in the modernize plugin

- Status: Accepted
- Date: 2026-10-23
- Decision register: D54
- Amends: [ADR-0035](0035-kintsugi-plugins-marketplace.md), [ADR-0049](0049-design-sets-generated-by-the-runtime.md)

## Context

The design stage lived in the `design` plugin (runtime); the `modernize` plugin carried the stages run by members in their own harness (`design-architecture`, `scaffold`, `implement`) and depended on `design`. With the member harness gone ([ADR-0067](0067-remove-access-and-review-plugins.md)) the split has no purpose, and the later stages (implement, test, ...) will run in the runtime too.

## Decision

1. One plugin, `modernize` (2.0.0), audience `runtime`, requires `reverse_engineering`. It carries the design stage (command `design`, agents `designer`, `design-reviewer` and `architecture-critic`, the design-set scripts with their fixtures and the skills `design-template-contract` and `design-writing`). The `design` plugin is removed.
2. The commands, agents and workflow that only a member's harness ran (`design-architecture`, `scaffold`, `implement`, `scaffolder`, `test-engineer`, the `scaffold` workflow) are removed. They stay in Git history; the later stages are written again as runtime stages and added to this plugin.
3. The stage ids, the command file `commands/modernize-design.md` and its behaviour do not change.

## Consequences

- Administration → Plugins lists two built-in plugins.
- The pipeline order is `assess`, `understand`, `plan-understand`, `design`; a stage added later is placed in `COMMAND_ORDER`.
- No built-in agent has the `member` audience; the audience is still validated for administrator-created agents.
