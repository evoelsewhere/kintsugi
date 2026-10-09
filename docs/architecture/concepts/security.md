# Security

## Threat model in short

- **Legacy repositories are untrusted input.** They may contain prompt-injection payloads aimed at agents.
- **pi provides no isolation.** It has no sandbox and no permission system, and its project trust is not a security boundary.
- **The worker can start containers.** That makes its Docker API access the most sensitive privilege in an installation.
- **Members' harnesses run outside Kintsugi's control.** Governance there relies on policy distribution and gates.

## Runtime jobs ([ADR-0004](../../decisions/0004-runner-container-per-job.md))

1. **Isolation**: one Docker container per job:
   - non-root user
   - `--read-only` root filesystem
   - `cap-drop ALL`
   - `no-new-privileges`
   - CPU, memory and time limits
   - gVisor (`runsc`) when available
2. **Mounts**: the Git checkout is read-only at `/src`. Only `/out` is writable, and the worker validates it before committing anything.
3. **Tools**: read-only by default (`read`, `grep`, `find`, `ls`) plus Kintsugi tools. `bash`, `edit` and `write` are off unless an agent definition explicitly allows them.
4. **Untrusted context**: pi runs with `--no-context-files --no-extensions --no-approve` and loads only Kintsugi's allowlisted extension.
5. **Credentials**: only the credentials of the provider the job uses are injected (env / `ModelRuntime.setRuntimeApiKey`), never written to disk. A job-scoped `models.json` is generated per job.
6. **Network**: the internal `jobs` network reaches only `kintsugi-app` (job gateway, KB tools) and `egress-proxy`, which allowlists the configured LLM provider hosts. The runner never talks to Git.
7. **Job token**: short-lived, read-only, scoped to one project.
8. **Status**: job status comes from events (`agent_settled`, errors), not from the exit code.
9. **Upgrades**: run the runtime agents' eval suite before upgrading pi.

## Installation

- **Exposure**: only `kintsugi-app` is published.
- **Secrets**: LLM keys and Git credentials are encrypted in Postgres with `KINTSUGI_SECRET_KEY`.
- **Docker API**: the worker goes through `docker-socket-proxy`, limited to container lifecycle calls. The worker accepts only the `kintsugi-runner:<version>` image and only mounts inside the job directory ❓ (D32).
- **Worker commits**: authored by a bot account and carrying job/agent trailers ([workspace repo](../../reference/workspace-repo.md#commit-conventions)).

## Member harnesses

- `HarnessPolicy` distribution covers allowed models, allowed MCP servers, content exclusions for sensitive files, and required commit trailers.
- Gates check trailers and AI-usage declarations on PRs.
- The MCP server authenticates every call with the member's PAT and checks project and role permissions.

## Audit

The audit log is append-only and hash-chained. It records:
- sign-ins
- provider and policy changes
- runtime tool calls, allowed or blocked
- MCP calls
- worker commits
- gate decisions
- asset publications
