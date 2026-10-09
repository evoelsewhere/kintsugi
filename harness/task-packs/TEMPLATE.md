<!-- Task pack template. Filled by the task-planner runtime agent and committed to the workspace repo
     at tasks/<work-item-id>.md; members get it with `kintsugi task start <id>` or MCP `task.get`. -->
# {{workItem.id}} — {{title}}

## Objective
{{objective}}

## Acceptance criteria
{{#each acceptanceCriteria}}- [ ] {{this}}
{{/each}}

## AS-IS context (from KB)
{{#each context}}- {{source}}: {{excerpt}}
{{/each}}

## Relevant paths
{{#each relevantPaths}}- `{{this}}`
{{/each}}

## Rules checked at gate review
{{#each rules}}- {{this}}
{{/each}}

## Suggested skills
{{#each suggestedSkills}}- {{this}}
{{/each}}

## Deliverables
{{#each deliverables}}- **{{type}}** — {{description}} → commit to `{{path}}` in {{repo}}, then register with `kintsugi artifact register` or MCP `artifact.register`
{{/each}}

## When done
Open a PR referencing `{{workItem.id}}`, add the `Assisted-by: <harness>` trailer to AI-assisted commits, and fill in the AI-usage section of the PR template.
