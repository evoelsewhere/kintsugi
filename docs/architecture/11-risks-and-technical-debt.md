# 11. Risks and technical debt

| Risk | Impact | Mitigation |
|---|---|---|
| pi APIs change quickly (1.0 shipped 2026-10-01; releases near-daily) | Runner breakage on upgrade | Pin the exact version; wrap pi inside `services/runtime`; run the kernel smoke suite before upgrading (D27, ADR-0023) |
| Earendil's future licensing of non-core layers | Licensing exposure | Depend only on pi's MIT core packages |
| No OS-level isolation of runtime jobs ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)) | A malicious script or dependency, or a prompt-injected `shell` command, reads what the worker's OS user can read, including the worker's environment with the database URL and the master key that decrypts every stored credential, and reaches the network | Job workspace with read-only sources, cleared environment for the job's own processes, built-in scripts only (model-written ones hashed), JobOutput hook; worker as a non-root user without credentials on disk; worker egress restricted at the network level, required wherever legacy code is untrusted ([Security](concepts/security.md), items 2 and 8). Planned: run job processes under an OS user of their own, or start the worker without its secrets in its environment, so a job cannot read them |
| Prompt injection from legacy repos | Data exfiltration, misleading outputs | Read-only job workspace and kernel path confinement, tool allowlists per agent, no repo context files, worker-side validation of `out`, human review via PRs; Kintsugi filters no egress, so it is restricted at deployment level where required |
| Uneven telemetry from member harnesses | Incomplete AI metrics | MCP/CLI and PR conventions as the primary source; OTel and vendor APIs as supplementary sources |
| Members using harnesses outside policy | Code sent to disallowed models | Policy distribution, content exclusions, trailer/declaration gates, training |
| Harness-native paths and policy mechanisms change often | Broken asset rendering | Verify against vendor docs per release; snapshot tests per renderer (ADR-0005) |
| Behavior differences across harnesses | Inconsistent quality | One task-pack / skill standard |
| pg-boss instead of a workflow engine | Retry and compensation logic is hand-written | Keep steps short and idempotent; revisit Temporal only if compensation logic grows (ADR-0003) |
| Polling-based change detection | Delay before reviews and ingestion | Configurable interval; webhooks where the Git server can reach the installation (D30) |
| Large binaries in Git | Repo bloat | Git LFS or a side volume (D31) |
| Frequent bot commits for unit state | Noisy history, push contention, branch-protection friction | `10-applications/*/02-modern/*/*/README.md` as auto-commit paths for `kintsugi-bot`; batching of non-urgent changes; fetch → rebase → retry (ADR-0012, ADR-0038) |
| Direct Git edits bypass validation | Inconsistent state | Direct edits only via PRs; validation on sync; invalid changes flagged and not indexed |
| Upfront effort to write standards per project | Slower start | Copy/adapt from earlier projects; guided build flow; agents help draft conventions |
| Standards that look right but are wrong | Systematic defects across many units | Pilot units first; standards change by reviewed PR; the document repo commit is recorded on every output so affected units can be found |
| Extension supply chain (built-in scripts and workflows, harness transformer plugins) | Malicious or vulnerable code inside the installation | Built-in scripts and workflows only, reviewed per release (model-written scripts hashed); admin-only plugin install; audit of every use. Jobs have network access ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)): restrict the worker's egress at deployment level where required |
| Project plugins run hooks and scripts on members' machines | Unsafe or unwanted code executed locally | Plugins change only through reviewed PRs to the document repo; validation on every change; members see the plugin contents before installing |
| Plugin formats diverge across vendors | Broken installs for some harnesses | Claude Code format as canonical; generated per-vendor marketplaces / manifests with snapshot tests; fallback renderer when a harness lacks support |
| Members disable hooks or plugins | Less guardrail and telemetry coverage | Hooks are assistive; gates, trailers and server-side checks remain authoritative; `requiredPlugins` visible on the board |
