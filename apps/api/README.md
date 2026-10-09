# apps/api

REST + OpenAPI API (framework open: NestJS or Fastify, D10) for the Admin, Delivery, Monitoring and Governance modules (docs/architecture/05-building-block-view.md). Runs in `kintsugi-app` together with the portal's static build, the Kintsugi MCP server and CLI API (`services/harness-hub`), and the internal job gateway that runner containers post `JobEvent`s to.

- Auth: local username/password sessions + Personal Access Tokens; `AuthProvider` interface for Entra ID later (ADR-0008).
- Admin → LLM Providers: runtime provider registry (ADR-0009).
