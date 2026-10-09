# 11. Risks and technical debt

| Risk | Impact | Mitigation |
|---|---|---|
| pi APIs change quickly (1.0 shipped 2026-10-01; releases near-daily) | Runner breakage on upgrade | Pin the exact version; wrap pi inside `services/runtime`; run the eval suite before upgrading (D27) |
| Earendil's future licensing of non-core layers | Licensing exposure | Depend only on pi's MIT core packages |
| Worker's Docker API access | Host compromise if the worker is compromised | docker-socket-proxy restricted to container lifecycle; image and mount allowlist (D32) |
| Prompt injection from legacy repos | Data exfiltration, misleading outputs | Read-only mounts, egress allowlist, no repo context files, worker-side validation of `/out`, human review via PRs |
| Uneven telemetry from member harnesses | Incomplete AI metrics | MCP/CLI and PR conventions as the primary source; OTel and vendor APIs as supplementary sources |
| Members using harnesses outside policy | Code sent to disallowed models | Policy distribution, content exclusions, trailer/declaration gates, training |
| Harness-native paths and policy mechanisms change often | Broken asset rendering | Verify against vendor docs per release; snapshot tests per renderer (ADR-0005) |
| Behavior differences across harnesses | Inconsistent quality | One task-pack / skill standard; `gate-reviewer` judges the PR result |
| pg-boss instead of a workflow engine | Retry and compensation logic is hand-written | Keep steps short and idempotent; revisit Temporal only if compensation logic grows (ADR-0003) |
| Polling-based change detection | Delay before reviews and ingestion | Configurable interval; webhooks where the Git server can reach the installation (D30) |
| Large binaries in Git | Repo bloat | Git LFS or a side volume (D31) |
