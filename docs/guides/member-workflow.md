# Work on a migration task as a member

> **Planned behavior.** This applies once the Harness Hub is implemented (milestone M2).

You implement work items in **your own AI harness** (Claude Code, GitHub Copilot or ChatGPT/Codex). Kintsugi gives you the context and reviews the result. Background: [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).

## One-time setup

1. In the portal, create a **Personal Access Token** (Profile → Access tokens).
2. Install the CLI and sign in:
   ```bash
   kintsugi login --url https://kintsugi.example.internal --token <PAT>
   ```
3. Install the project's plugins. They include the built-in `kintsugi` plugin (task workflow, Kintsugi MCP server, guardrail hooks) and the project's stack plugins.
   ```bash
   kintsugi plugins setup --harness <claude-code|copilot|codex|chatgpt>
   ```
   This adds the document repo as a plugin marketplace and installs from it with your harness's own commands. In Claude Code you can also run `/plugin marketplace add <document-repo-url>` and `/plugin install kintsugi@<project>`.

   When prompted, enter the Kintsugi URL and your PAT. The PAT is stored in the harness's secure storage. Harnesses without plugin support get an equivalent rendering of skills and MCP, without hooks.

## For each work item

1. **Start the task.**
   ```bash
   kintsugi task start <work-item-id>
   ```
   This claims the unit for you, so the board shows you as assignee. It also creates a branch in the target repo and fetches the task pack (`tasks/<id>.md` in the document repo).
2. **Work in your harness.** Point it at the task pack. Follow the standards it cites (conventions, mappings, review rules in `standards/`), use the suggested skills, and query the KB through MCP (`kb.search`, `kb.ask`). If a rule is missing or wrong, propose a PR to `standards/` in the document repo instead of deciding locally.
3. **Commit.**
   - Put code in the target repo. Source (legacy) repos are read-only.
   - Put deliverables (detail design, test report…) in the document repo, at the paths listed in the task pack.
   - Add `Assisted-by: <harness>` to AI-assisted commits.
4. **Open PRs.** Reference the work item id and fill in the AI-usage section of the PR template.
5. **Register deliverables.**
   ```bash
   kintsugi artifact register <path> --type <type>
   ```
6. **Review.** `gate-reviewer` comments on your PR. Address the findings; a human reviewer approves and merges.

Exact tool and command lists: [harness integration reference](../reference/harness-integration.md).
