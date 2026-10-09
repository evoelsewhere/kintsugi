# Work on a migration task as a member

> **Planned behavior.** This applies once the Harness Hub is implemented (milestone M2).

You implement work items in **your own AI harness** (Claude Code, GitHub Copilot or ChatGPT/Codex). Kintsugi gives you the context and reviews the result. Background: [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).

## One-time setup

1. In the portal, create a **Personal Access Token** (Profile → Access tokens).
2. Install the CLI and sign in:
   ```bash
   kintsugi login --url https://kintsugi.example.internal --token <PAT>
   ```
3. Connect your harness to the Kintsugi MCP server. The command below writes the MCP configuration and skills in your harness's format:
   ```bash
   kintsugi assets pull --harness <claude-code|copilot|codex|chatgpt>
   ```

## For each work item

1. **Start the task.**
   ```bash
   kintsugi task start <work-item-id>
   ```
   This creates a branch in the code repo and fetches the task pack (`tasks/<id>.md` in the workspace repo).
2. **Work in your harness.** Point it at the task pack. Use the suggested skills, and query the KB through MCP (`kb.search`, `kb.ask`).
3. **Commit.**
   - Put code in the code repo.
   - Put deliverables (detail design, test report…) in the workspace repo, at the paths listed in the task pack.
   - Add `Assisted-by: <harness>` to AI-assisted commits.
4. **Open PRs.** Reference the work item id and fill in the AI-usage section of the PR template.
5. **Register deliverables.**
   ```bash
   kintsugi artifact register <path> --type <type>
   ```
6. **Review.** `gate-reviewer` comments on your PR. Address the findings; a human reviewer approves and merges.

Exact tool and command lists: [harness integration reference](../reference/harness-integration.md).
