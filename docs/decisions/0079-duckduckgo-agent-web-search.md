# ADR-0079: Opt-in DuckDuckGo search through a worker-bound tool

- Status: Accepted
- Date: 2026-10-25
- Decision register: D93

Extended by [ADR-0080](0080-public-web-fetch-and-expanded-research.md): expanded budgets and separately permitted public-page retrieval.

## Context

Runtime agents sometimes need current public technical references. Search must be agent-directed, optional per project, bounded across parallel jobs and retries, and available without paid provider credentials. DuckDuckGo's Instant Answer API does not provide full web results. Its public HTML search offers links and snippets but can throttle or challenge automated traffic.

## Decision

Expose one optional model-only tool, `web_search`, through a caller-bound worker service. The runtime kernel owns the generic tool contract; the worker owns DuckDuckGo access and project policy. Reuse one private IPC transport and host admission mechanism for memory and web services. No credentials, project selectors, arbitrary endpoints or filesystem access are accepted as tool arguments.

Projects explicitly enable outbound search and select agent names in the portal. Disabled is the default; the initial selection is `designer`. The worker grants the tool only to selected agents with a nonempty tool list. A file-read permission alone grants no web access. Each request checks current policy; an in-flight response is discarded after disabling or removing the agent. Existing conversation content cannot be revoked.

Use DuckDuckGo's fixed HTTPS HTML endpoint with redirects disabled, no browser, cookie persistence, paid API, automatic retry, CAPTCHA solving or anti-bot evasion. Parse links and snippets with Cheerio. Changed HTML and challenges produce an unavailable error, not a fabricated empty result. Search is a best-effort aid; agents continue without it when blocked.

Persist reservations in Postgres: at most three upstream attempts per agent step and eight per top-level run, including failed requests and retries. Serialize searches per project with an expiring lease and a minimum two-second interval between starts. The worker validates input and checks for obvious credential patterns before reservation. Tool responses are bounded to 12 KB and at most five results. The upstream request has a 20-second timeout and a 1 MB decompressed body ceiling.

Search results are untrusted external reference data. Tools instruct agents to send only public technical terms, ignore instructions embedded in results, cite URLs, and distinguish external guidance from project facts. Credential-pattern detection cannot classify all private text. The project setting authorizes outbound queries, not automatic uploads of source files or documents. Existing shell/MCP network capabilities are outside this tool's boundary.

Full page retrieval, cross-run caching and web evidence in project memory are not included. The search snippets are not fetched-page evidence; agents may not represent them as verified repository evidence. There is no automatic search, prompt injection of search results, or memory write.

## Consequences

No provider key, Python runtime, additional service or datastore is needed. Operators explicitly opt projects in; the permission `project.web-search.manage` governs configuration, and changes are audited. Normal tool events/spans record use; reservation rows store only identifiers and timestamps, while existing run records may contain the model's query and returned snippets.

DuckDuckGo is not a contracted search API: availability, rate limits and page structure may change. This is not guaranteed unlimited free search. A future provider adapter can preserve the tool contract. A governed full-page fetcher needs a separate URL/redirect/DNS security review before implementation. External search claims do not supersede project documents.

## Alternatives considered

- **Instant Answer API:** insufficient for general web result discovery.
- **SearXNG:** useful for managed multi-engine search, but adds a service and operational overhead.
- **Third-party DuckDuckGo library or MCP:** adds a wrapper without removing upstream throttling; current Kintsugi MCP registry uses HTTP, while common local DuckDuckGo wrappers require a subprocess.
- **Exa/Tavily:** retain as possible adapters; the selected implementation is DuckDuckGo without a provider key.
