# Work on a migration task as a member

Use your own coding agent, such as Claude Code or Codex. Kintsugi gives that agent authorized task context and records pull request progress; it does not run the member's coding session. See [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md) for the system boundary.

## Connect your coding agent once

1. Make sure your Kintsugi administrator has granted you `member.read` and Project Access for the project. The project must have its document repository configured. Install Node.js 22.19 or newer and a supported AI client.
2. Open the project's **Coding Agent Workflow** section in Kintsugi and copy the generated setup command. It includes the configured installation URL and project ID.
3. Install the Kintsugi CLI if it is not already available, then run the setup command. It installs the project plugin and saves only a nonsecret local profile; it does not require a personal token.
4. Start a new AI client session. The first time the agent requests Kintsugi context, the CLI opens a browser for Kintsugi sign-in and project consent. Kintsugi issues short-lived access and rotating refresh credentials. Access is limited by current permission, Project Access, and the administrator's 15- or 30-day connection policy.

For the unpublished local preview, build the CLI from the Kintsugi repository root and run `pnpm kintsugi plugins setup ...`; after publication, use the command copied from the portal.

## Work through the task and pull request

Ask your agent to find your Kintsugi tasks or explain the design, standards, acceptance criteria, and evidence for a task. Its plugin tells it when to retrieve Kintsugi context through read-only MCP tools. The agent reads cited documents, then uses its normal coding tools in your code repository.

Commit and open the pull request with your usual GitHub account and client. Kintsugi's separate GitHub provider connection observes the PR and reviews. The agent can retrieve current findings and task status from Kintsugi, and Kintsugi can continue the workflow when its configured gates become effective. Human approvals remain in Kintsugi. The MCP connection cannot edit tasks, documents, repositories, approve gates, or merge pull requests.

Direct CLI commands are available for task/context retrieval, review findings, and task-event watch. They use the same project authorization. Run `kintsugi --help` or read the [Coding Agent Workflow CLI reference](../reference/coding-agent-cli.md) for commands. GitLab, Bitbucket, AWS-hosted repositories, Copilot CLI, and hosted AI chats remain separate compatibility or provider milestones.
