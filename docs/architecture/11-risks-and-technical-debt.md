# 11. Risks and technical debt

| Risk | Impact | Mitigation |
|---|---|---|
| pi APIs change quickly (1.0 shipped 2026-10-01; releases near-daily) | Runner breakage on upgrade | Pin the exact version; wrap pi inside `services/runtime`; run the kernel smoke suite before upgrading (D27, ADR-0023) |
| Earendil's future licensing of non-core layers | Licensing exposure | Depend only on pi's MIT core packages |
| No OS-level isolation of runtime jobs ([ADR-0029](../decisions/0029-job-workspaces-instead-of-os-sandboxes.md)) | A malicious script or dependency reads what the worker's OS user can read and reaches the network | Job workspace with read-only sources, cleared environment, built-in scripts only (model-written ones hashed), JobOutput hook; worker as a non-root user without credentials on disk; network restrictions at deployment level |
| Prompt injection from legacy repos | Data exfiltration, misleading outputs | Read-only mounts, egress allowlist, no repo context files, worker-side validation of `/out`, human review via PRs |
| Uneven telemetry from member harnesses | Incomplete AI metrics | MCP/CLI and PR conventions as the primary source; OTel and vendor APIs as supplementary sources |
| Members using harnesses outside policy | Code sent to disallowed models | Policy distribution, content exclusions, trailer/declaration gates, training |
| Harness-native paths and policy mechanisms change often | Broken asset rendering | Verify against vendor docs per release; snapshot tests per renderer (ADR-0005) |
| Behavior differences across harnesses | Inconsistent quality | One task-pack / skill standard; `gate-reviewer` judges the PR result |
| pg-boss instead of a workflow engine | Retry and compensation logic is hand-written | Keep steps short and idempotent; revisit Temporal only if compensation logic grows (ADR-0003) |
| Polling-based change detection | Delay before reviews and ingestion | Configurable interval; webhooks where the Git server can reach the installation (D30) |
| Large binaries in Git | Repo bloat | Git LFS or a side volume (D31) |
| Frequent bot commits for unit state | Noisy history, push contention, branch-protection friction | `10-applications/*/02-modern/*/*/README.md` as auto-commit paths for `kintsugi-bot`; batching of non-urgent changes; fetch → rebase → retry (ADR-0012, ADR-0038) |
| Direct Git edits bypass validation | Inconsistent state | Direct edits only via PRs; validation on sync; invalid changes flagged and not indexed |
| Upfront effort to write standards per project | Slower start | Copy/adapt from earlier projects; guided build flow; agents help draft conventions |
| Standards that look right but are wrong | Systematic defects across many units | Pilot units first; standards change by reviewed PR; the document repo commit is recorded on every output so affected units can be found |
| Extension supply chain (runner images, harness transformer plugins) | Malicious or vulnerable code inside the installation | Installation allowlists, admin-only plugin install, network `none` for runners by default, audit of every use |
| Project plugins run hooks and scripts on members' machines | Unsafe or unwanted code executed locally | Plugins change only through reviewed PRs to the document repo; validation on every change; members see the plugin contents before installing |
| Plugin formats diverge across vendors | Broken installs for some harnesses | Claude Code format as canonical; generated per-vendor marketplaces / manifests with snapshot tests; fallback renderer when a harness lacks support |
| Members disable hooks or plugins | Less guardrail and telemetry coverage | Hooks are assistive; gates, trailers and server-side checks remain authoritative; `requiredPlugins` visible on the board |
