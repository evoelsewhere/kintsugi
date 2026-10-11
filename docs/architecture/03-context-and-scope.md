# 3. Context and scope

## 3.1 Business context

```
                        ┌──────────────────────────────┐
  Project members ─────►│                              │◄──── Member harnesses on members' machines
  (portal users)        │                              │      (Claude Code · Copilot · ChatGPT/Codex)
                        │      Kintsugi installation   │
  Git servers ◄────────►│  (portal · runtime · hub)    │────► LLM providers (runtime only)
  (code + workspace     │                              │
   repos, PRs)          │                              │◄───► Trackers / wikis (Jira, Confluence,
                        └──────────────────────────────┘      Azure DevOps, SharePoint)
                                       ▲
                                       └──── Observability of the target system (P6–P7):
                                             Datadog / New Relic / Splunk / PagerDuty
```

| Partner | Input to Kintsugi | Output from Kintsugi |
|---|---|---|
| Project members (portal) | Projects, decisions, approvals, configuration | Dashboards, KB answers, scorecards, gate status |
| Member harnesses | MCP / CLI calls: KB queries, task status, artifact registrations; plugin hook events; optional OTel | Task packs, agent plugins via the project marketplace (or fallback rendering), KB results, policies |
| Git servers (many) | Code, documents, PR events | Commits and PRs in the document repo; PR comments on code repos |
| LLM providers | Model responses (runtime jobs) | Prompts from runtime agents, sent only through the egress proxy |
| Trackers / wikis | Work item status, existing documents | Status sync |
| Target-system observability | Health, incidents | — |

## 3.2 Technical context

| Interface | Protocol | Direction | Notes |
|---|---|---|---|
| Portal / REST API | HTTPS, REST + OpenAPI, SSE for live events | Inbound | Behind the project's reverse proxy / TLS |
| Kintsugi MCP server | MCP Streamable HTTP, Bearer PAT | Inbound | [Harness integration](../reference/harness-integration.md) |
| `kintsugi` CLI | HTTPS REST, PAT | Inbound | |
| Git (any server) | git over HTTPS (token) or SSH (deploy key) | Outbound from the worker | Clone / fetch / push |
| Git provider APIs | HTTPS REST (GitHub, Azure DevOps, GitLab, Bitbucket, Gitea) | Outbound; webhooks inbound when reachable | PRs, comments; polling fallback |
| LLM providers | HTTPS | Outbound from `kintsugi-worker` (agent jobs) and `kintsugi-app` (connection tests) | Only the configured providers are called; no egress allowlist is enforced by Kintsugi |
| Harness telemetry | OTLP/HTTP (optional), vendor metrics APIs | Inbound / outbound polling | [Observability and telemetry](concepts/observability-and-telemetry.md) |

## 3.3 Out of scope

- Driving members' harnesses remotely or running server-side code generation for implementation work.
- Hosting the to-be system itself; Kintsugi only tracks and observes it.
- Replacing the tracker: Kintsugi syncs status but does not become the project's issue tracker.
