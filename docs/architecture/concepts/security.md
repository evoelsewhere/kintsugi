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
- **Docker API**: the worker goes through `docker-socket-proxy`, limited to container lifecycle calls ❓ (D32). It accepts:
  - `kintsugi-runner:<version>` for runtime jobs;
  - images on `KINTSUGI_JOB_IMAGE_ALLOWLIST` for rulebook runners;
  - mounts only inside the job directory.
- **Rulebook runners** ([ADR-0013](../../decisions/0013-composable-open-rulebook.md)) run project code in their own allowlisted image, with the same hardening as runtime jobs, network `none` by default, and no LLM credentials.
- **Extension trust boundary**: each extension has an installation-level control, and every use is audited.

  | Extension | Control |
  |---|---|
  | Runner images | Image allowlist |
  | Harness transformer plugins | Installed by admins only |

  Runtime agents are fixed in code: projects cannot add agents, tools or MCP servers to the runtime (ADR-0014).
- **Worker commits**: authored by a bot account and carrying job/agent trailers ([workspace repo](../../reference/workspace-repo.md#commit-conventions)).

## Member harnesses

- **Built-in plugin hooks** refuse writes to source repos and report activity. They are assistive: members can disable them and support varies by harness, so the authoritative controls stay server-side (gates, trailers, `gate-reviewer`).
- **Project plugins** can run hooks and scripts on members' machines. They change only through rulebook PRs approved by owners, are validated on every change, and are published only at `ready` (or `draft` for pilot units).
- **The PAT** for the Kintsugi MCP server is a sensitive `userConfig` value, kept in the harness's secure storage, not in files.
- `HarnessPolicy` distribution covers allowed models, allowed MCP servers, content exclusions for sensitive files, required commit trailers and required plugins.
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
