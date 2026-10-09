# ADR-0009: LLM provider configuration for the pi runtime

- Status: Accepted
- Date: 2026-10-09

## Scope
This covers LLMs used by the **Kintsugi Runtime (pi)** only. Members' harnesses (Claude Code, Copilot, ChatGPT/Codex) use their own licenses and are not configured here.

## Decision
- **Provider registry in the portal (Admin → LLM Providers)** supporting everything pi supports:
  - **Built-in providers.** The list comes from the pinned pi-ai version's catalog, not a hard-coded Kintsugi list, so a pi upgrade brings new providers automatically. Examples: Anthropic, OpenAI, Azure OpenAI, Amazon Bedrock, Google Gemini and Vertex, Mistral, Groq, Cerebras, xAI, DeepSeek, OpenRouter, Together, Fireworks, Hugging Face, Cloudflare and Vercel gateways.
  - **Custom providers** using pi's `models.json` model:
    - `baseUrl`
    - `api` (wire protocol, e.g. `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, `bedrock-converse-stream`, `mistral-conversations`)
    - `apiKey`
    - optional headers
    - `models[]` with `id`, `input`, `reasoning`, `contextWindow`, `maxTokens`, `cost`, `compat`
    - This covers vLLM, Ollama, LM Studio, LiteLLM and any internal gateway.
  - **Model overrides** (`modelOverrides`) for built-in models, such as sampling and prompt-cache settings.
- Credentials per provider are stored encrypted in Postgres:
  - `api-key`
  - provider environment settings (e.g. Azure `AZURE_OPENAI_BASE_URL` / `AZURE_OPENAI_API_VERSION` / deployment map; Vertex project and location; Bedrock region and keys)
  - service-account JSON
- **Agent → model binding**:
  - Each runtime agent has a default provider and model, overridable per project.
  - A model allowlist limits what can be bound.
  - Job budget is enforced from pi's per-message `usage.cost`; custom models declare their own cost.
- **Job launch**:
  - The worker writes a job-scoped `models.json` containing only the providers the job needs, plus that provider's credentials, into the runner container as environment variables.
  - The runner passes keys with `ModelRuntime.setRuntimeApiKey` where applicable.
  - The `egress-proxy` allowlist is derived from the configured provider endpoints.
- **Not allowed for the runtime:** OAuth subscription logins (Claude Pro/Max, ChatGPT, Copilot tokens). Use API keys or enterprise endpoints only.
- **"Test connection"** in the portal runs a minimal completion through a runner container.

## To verify during implementation
- The exact pi-ai API for enumerating the provider and model catalog.
- The complete `models.json` schema: header field name, `compat` keys, cost fields. See pi `docs/models.md` and `configuration.md`.
