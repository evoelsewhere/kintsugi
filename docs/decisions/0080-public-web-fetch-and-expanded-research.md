# ADR-0080: Add guarded public-page retrieval and expand web research

- Status: Accepted
- Date: 2026-10-26
- Decision register: D94

## Context

ADR-0079 supplies DuckDuckGo search snippets with small initial budgets. Agents need more research capacity and must read primary sources before relying on snippet details. A fetch tool widens the worker's outbound network access and needs a destination policy that remains effective across redirects and DNS changes. Page content must not be kept as snapshots or silently injected into memory.

## Decision

Keep agent-directed tools and the worker-bound service architecture. Increase search to 20 upstream attempts per logical step and 100 per root run, at most ten results, 1,000 query characters and 64 KB responses. Add a site restriction (applied to the query and enforced on returned hostnames), DuckDuckGo date/region hints, explicit truncation and point-in-time remaining quotas. Search uses the public HTML GET endpoint through the same guarded transport as fetch, without redirects or automatic retries.

Add `web_fetch`, with a separate project setting `fetchEnabled`, false for existing and new projects. It requires web access plus the selected agent grant. The runtime's generic capability, model-only loadout, IPC admission and safe errors cover both tools. Search and fetch budgets are independent; fetch permits 40 calls per logical step and 200 per root run. Reservations survive retries. Three fetches may run per project; search retains one active request and a two-second interval. Expiring database leases recover from worker failure. No new service, datastore or provider key is introduced.

Fetch accepts only a URL, a character offset, a chunk size and an optional expected content hash. It supports HTML, XHTML, text, Markdown and JSON. The worker removes non-content HTML, selects the main article where available, retains code blocks/headings/lists and returns readable text, reference links, the final URL, retrieval time and a SHA-256 hash of extracted text. Content is capped at 400,000 characters and returned in bounded chunks. Continuations refetch the URL and require the prior hash; changed content must be read from offset zero. There is no content cache or persisted page snapshot.

The fetch limit is 30 seconds across DNS, redirects and body reads, four redirects, standard HTTP/HTTPS ports, 2 MB of wire and decompressed bytes, and 64 KB per tool response. Default chunks are 16,000 characters, with a maximum of 32,000 before byte-based trimming. Redirects count within one fetch reservation. Failures consume reservations. PDF/OCR, browsers, JavaScript execution, cookies, logins and custom request headers are excluded.

## Security review

Implement the common public-web transport before both adapters. Parse destinations with WHATWG URL normalization. Reject credentials, non-HTTP schemes, nonstandard ports, local/special-use hostnames, and recognizable signed/secret query parameters. Resolve all IP addresses for each hostname and reject a response containing any nonpublic address. Use `ipaddr.js` for IPv4/IPv6 special-range classification and reject mapped/transition IPv6. Permit only allocated global-unicast IPv6, excluding known documentation space.

For each hop, connect using the validated address through a dedicated Node HTTP(S) request with a pinned lookup and fixed address family. Preserve the original Host, TLS SNI and certificate verification. No DNS lookup at connection time may change the destination. Revalidate every redirect, disallow HTTPS downgrades, and never forward caller headers, cookies or credentials. Native HTTP clients with a dedicated agent avoid ambient proxy configuration. Cap headers and both encoded/decompressed bodies, propagate cancellation, and destroy sockets/decoders after completion or errors.

All content remains untrusted external data. Tool descriptions require ignoring embedded instructions, citing the actual source URL and distinguishing external guidance from repository facts. URL/credential checks do not classify every confidential string or opaque token. Outbound tool permissions do not isolate pre-existing shell/MCP network access. A content hash identifies extracted text only and does not certify a site's claims. No automatic reviewed memory or repository evidence is created.

## Consequences

Agents can research in more detail and read long sources without retaining pages. Existing projects keep their search permission but must explicitly enable fetch. The portal explains both capabilities and their independent limits. Migration 040 adds fetch permission state, operation-specific reservations and fetch leases. Existing search reservations remain counted as search; no reset is needed.

Larger results consume more LLM tokens. DuckDuckGo still controls upstream throttling independently of application budgets. Extraction is deterministic best effort; a JavaScript application, a login page or an unusual layout may return little useful text. Continuation may fail on dynamic content, requiring a new first chunk. Future browser/PDF support or authenticated sources need their own contract and security review.
