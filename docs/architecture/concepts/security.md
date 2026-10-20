# Security

## Threat model in short

- **Legacy repositories are untrusted input.** They may contain prompt-injection payloads aimed at agents.
- **pi provides no isolation.** It has no sandbox and no permission system, and its project trust is not a security boundary.
- **There is no OS-level sandbox.** Runtime jobs and script steps run in job workspaces of the worker, as the worker's OS user, with network access ([ADR-0029](../../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)). The worker's own privileges bound what a job can reach.
- **Members' harnesses run outside Kintsugi's control.** Governance there relies on policy distribution and gates.

## Runtime jobs ([ADR-0029](../../decisions/0029-job-workspaces-instead-of-os-sandboxes.md))

1. **Job workspace**: every job gets `<data>/jobs/<id>/` with `src` (a detached worktree of the source repository at the job's commit) and `in` (the step's inputs), both marked read-only, plus a writable `out` and a scratch `tmp` that is deleted when the step ends. This is the isolation boundary; there is no container, VM or OS sandbox, and **no network blocking**.
2. **Script steps and hooks**: a child process with explicit path arguments (no shell), `cwd` in the job directory and a cleared environment: no credentials, `DATABASE_URL`, `KINTSUGI_SECRET_KEY` or Kintsugi tokens; `HOME` and `TEMP` point into `tmp`. Python runs isolated (`-I`); Node runs with its permission model (file access limited to the workspace, no child processes). A wall-clock timeout and an output-size cap kill the whole process tree; the script's sha256 is recorded. Nothing is installed at run time.
3. **Agent jobs and tools**: run in the worker through the kernel ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md), [ADR-0040](../../decisions/0040-kernel-shell-and-git-tools.md)); only the kernel tools in the agent's allowlist are created: `read`, `ls`, `grep`, `find` confined (symlinks resolved) to `src` and `in`, and pi's `write` and `edit` confined to `out` (a relative path starts there). `shell` and `git` run as child processes under the same rules as script steps (cleared environment, timeout, kill-tree): `git` takes explicit arguments, runs read-only subcommands anywhere in the workspace and mutating ones only under `out` and `tmp`, and refuses alias expansion and redirecting/helper options. pi's `bash` is never registered. New kernel tools are added by code, with a review of their security boundary.
4. **Untrusted context**: the kernel's pi session discovers nothing from the checkout or the host: no context files, `.pi/` resources, settings files, packages, `SYSTEM.md`, MCP, codemode or tool search. The system prompt is the agent's instructions and skills, verbatim.
5. **Credentials**: the provider's credentials are decrypted per job and handed to pi in memory (`ModelRuntime.setRuntimeApiKey`); no `models.json` or `auth.json` is written, and scripts never see them. Providers that need process environment variables are refused for in-worker jobs.
6. **Output checks**: after every step, `out/restricted/` is stored encrypted as restricted records (readable with `restricted.read`, never committed or logged) and removed; credential-shaped values left in `out/` are masked in place first (`hooks/mask_output.py`, same patterns as the hook, logged by rule and location only); the JobOutput hook then checks `out/` fail-closed for any credential-shaped value that remains and for malformed artifacts, and the failure reason is built from its redacted report only; then the writer applies its output rules before committing ([ADR-0019](../../decisions/0019-workspace-repo-write-path.md)).
7. **Status**: job status comes from events and exit codes, never assumed. LLM errors, aborts, timeouts and exceeded limits (`maxTurns`, `maxCostUsd`, output size) end the run as `failed` with a redacted reason.
8. **Operating the worker**: run it as a dedicated non-root user whose only writable location is the data directory, with no credentials on its filesystem; restrict its egress at the network level if required (Postgres, Git servers, LLM providers). Memory and CPU are bounded for the worker as a whole, not per job.
9. **Upgrades**: run the kernel smoke suite before upgrading pi ([ADR-0018](../../decisions/0018-pin-pi-exact-version.md), amended by ADR-0023).

## Installation

- **Exposure**: only `kintsugi-app` is published.
- **Secrets**: LLM keys and Git credentials are encrypted in Postgres with `KINTSUGI_SECRET_KEY`.
- **Docker API**: none. The worker starts no containers (ADR-0029).
- **Extension trust boundary**: each extension has an installation-level control, and every use is audited.

  | Extension | Control |
  |---|---|
  | Scripts and workflows | Built-in content only (`packages/agents/builtin`), reviewed per release; model-written scripts run in the job workspace with their hash recorded |
  | Harness transformer plugins | Installed by admins only |

  Agents are installation data (built-in or created by admins, ADR-0026) supplied per job by Kintsugi; projects cannot add agents, tools or MCP servers to the runtime. Kernel path confinement and tool allowlists are the agents' isolation inside the job workspace (ADR-0023, ADR-0029).
- **Worker commits**: authored by a bot account and carrying job/agent trailers ([document repo](../../reference/document-repo-commit-conventions.md)).

## Member harnesses

- **Built-in plugin hooks** refuse writes to legacy repos and report activity. They are assistive: members can disable them and support varies by harness, so the authoritative controls stay server-side (gates, trailers, gate review).
- **Project plugins** can run hooks and scripts on members' machines. They change only through reviewed PRs to the document repo's `plugins/` and are validated on every change.
- **The PAT** for the Kintsugi MCP server is a sensitive `userConfig` value, kept in the harness's secure storage, not in files.
- `HarnessPolicy` distribution covers allowed models, allowed MCP servers, content exclusions for sensitive files, required commit trailers and required plugins.
- Gates check trailers and AI-usage declarations on PRs.
- The MCP server authenticates every call with the member's PAT and checks project scope plus the member's effective installation access-role permissions.

## Audit

The audit log (`governance.audit_event`) is append-only: database triggers refuse updates, deletes and truncation. Hash-chaining the entries is still proposed (D26). Entries say who acted, when, what the action was and what it acted on. They never carry the content acted on, credentials, key values or passwords: only ids, names, changed field names and small detail such as a gate's note.

### Audit coverage

Use cases record through one port (`AuditTrail`, API shared kernel); controllers do not record. Recorded today:

- **Sensitive reads**: every restricted record read (`restricted.read`). This entry is fail-closed: it is written before the content is returned, and nothing is returned when it cannot be written.
- **Delivery**: stage runs requested, job runs cancelled, `kintsugi.yaml` published.
- **Configuration**: projects, applications and repository links; Git servers and repositories; LLM providers (never key values) and model bindings; agents and shared skills (create, update, delete, enable, disable, import, copy, restore); the commit identity.
- **Access**: roles created and deleted, role permissions changed (added and removed codes), members created, updated (roles added and removed, enabled), password resets (never the password) and deletions.
- **Gates**: requests (by a person or the worker) and decisions with their note.

Changes are recorded after they succeed. A failed append is logged as an error and does not undo the change, so an operator sees the gap in the logs. The full action list is in the [data model](../../reference/data-model.md#audit-log).

Still planned: sign-ins, runtime tool calls (allowed or blocked), MCP calls, worker commits (today they are traceable through `workflow.document_write` and commit trailers) and asset publications.
