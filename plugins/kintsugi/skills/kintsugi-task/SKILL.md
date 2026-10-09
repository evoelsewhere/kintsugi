---
name: kintsugi-task
description: Work on a Kintsugi migration work item from its task pack — follow the cited rulebook rules, commit to the right repos with the required trailers, and register deliverables. Use whenever the user mentions a Kintsugi task, work item, task pack, or unit id.
---

# Working a Kintsugi task

## Before you start
1. Get the task pack. Use MCP `task.get` (Kintsugi server), or read `tasks/<work-item-id>.md` in the workspace repo after `kintsugi task start <id>`.
2. Read every rule the task pack cites (`rulesApplied`): mappings, UI patterns, review rules. Also read the conventions it links to. These are the project's decisions. Follow them and do not invent alternatives.
3. Query the knowledge base with `kb.search` / `kb.ask` for AS-IS behavior you are unsure about. Cite what you rely on.

## While working
- **Source (legacy) repos are read-only.** Change code only in the target repo, on the branch created for the task.
- Put deliverables (detail designs, test reports, …) in the workspace repo at the paths the task pack lists.
- If a rule is missing, unclear or wrong, stop and tell the user. The fix is a rulebook PR, not a local decision.

## When done
1. Add the trailer `Assisted-by: <harness>` to every AI-assisted commit (`claude-code`, `copilot`, `codex`, …).
2. Open PRs that reference the work item id, and fill in the AI-usage section of the PR template.
3. Register each deliverable: MCP `artifact.register` (path, type, AI share), or `kintsugi artifact register <path> --type <type>`.
4. Update the task status with `task.update` (`awaiting-review`).
