# Runtime web search

Runtime agents can use DuckDuckGo to discover public technical references ([ADR-0079](../decisions/0079-duckduckgo-agent-web-search.md)). Search is optional and agent-directed. No query or result is preloaded into a job.

## Configuration

In **Administration → Projects → project → Web search**, enable outbound search, select the runtime agents allowed to use it, and save. Configuration requires `project.web-search.manage`, introduced by migration `039_duckduckgo_web_search.sql`. Projects start disabled with `designer` preselected. New agents are not added automatically. An agent with an empty tool list receives no search tool.

`GET /api/admin/projects/:projectId/web-search` returns `{ enabled, agents }` inside the normal response envelope. `PUT` accepts the same fields. No API key, provider URL, environment setting or additional service is required. Changes are audited without query content.

The tool is supplied when a selected agent starts executing. Each call checks live permission. Disabling or removing an agent blocks subsequent calls. Saving a policy change invalidates results of requests already in flight, even if search is re-enabled before they complete; data already returned remains in the conversation. Re-enable or add an agent before its next execution to grant the tool. Project policy does not change existing shell or MCP network access.

## Tool contract

```json
{"query":"PostgreSQL transaction isolation documentation","maxResults":5}
```

`web_search` accepts only `query` (1–300 trimmed characters, no control or formatting characters) and optional `maxResults` (1–5). The response contains:

- `provider`: `duckduckgo`.
- `retrievedAt`: UTC retrieval time, not the publication date.
- `results`: title, URL and plain-text snippet for each result, excluding marked advertisements and duplicate URLs.
- `notice`: results are untrusted snippets and are not fetched-page evidence.

Results are limited to 12 KB. The tool does not open the returned URLs. Use URLs as external references, not as proof of what a project's source does. No automatic memory write or external-evidence certification occurs.

## Limits and errors

The worker reserves each upstream attempt in Postgres before sending a query:

| Limit | Value |
|---|---|
| Attempts per agent step | 3 |
| Attempts per top-level run, shared by children | 8 |
| Results per query | Up to 5 |
| Simultaneous requests per project | 1, with an expiring lease |
| Interval between project request starts | At least 2 seconds |
| Upstream timeout | 20 seconds |
| Upstream decompressed body | At most 1 MB |

Failed and aborted requests consume their reservation. Reservations survive retries and worker restarts. Logical step keys preserve the per-step limit when a retry allocates new child run identifiers. Denials before reservation do not count. Retries re-execute agents/workflows that could use mutable search rather than reusing their old outputs; this does not reset the run budget.

CAPTCHA, HTTP failure, changed page structure, excessive response size, timeout and rate limiting produce a tool error. Explicit no-results pages return an empty list. The agent is instructed to continue without search rather than repeatedly retry. No automatic provider fallback or anti-bot workaround is used.

## Data handling and security review

Only the supplied query goes to a fixed DuckDuckGo HTTPS endpoint. Redirects are refused. The worker never connects to result URLs; result URLs are data. Parsing does not execute scripts or load page resources. The child process receives only its capability and result, not database credentials or project selectors.

Agents are instructed to use public technical terms and exclude source code, documents, internal project names, credentials and personal data. The worker rejects obvious credential patterns; it cannot reliably recognize every confidential phrase. Enabling search therefore authorizes selected agents to send queries outside the installation.

Search output is untrusted and may contain misleading text or instructions. Agents must ignore embedded instructions and verify consequential claims against primary sources. Repository documents and their pinned evidence remain authoritative.

Request reservation rows store project/run/step identifiers and timestamps, not query text. Agent summaries count calls (including denied or failed service requests); these differ from upstream reservations. Existing job tool events, transcripts and telemetry may record redacted arguments and results under their normal retention policy. DuckDuckGo may observe queries and the worker's outbound IP. There is no Kintsugi search-content cache or page snapshot.

## Operational limits

The integration uses DuckDuckGo HTML search, not its limited Instant Answer API or a contracted full-results API. It has no provider charge or key but no guaranteed availability, quota or page format. LLM tokens used to formulate queries and read results still count toward the run's LLM cost. Use low query volume and expect unavailable errors on some networks.
