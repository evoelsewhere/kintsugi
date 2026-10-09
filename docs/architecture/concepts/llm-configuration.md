# LLM configuration (runtime only)

Decision: [ADR-0009](../../decisions/0009-llm-provider-config.md). This covers LLMs used by the **Kintsugi Runtime**. Members' harnesses use their own licenses and are not configured here.

## Provider registry

| Kind | What it covers |
|---|---|
| **Built-in** | Every provider in the pinned pi-ai catalog, e.g. Anthropic, OpenAI, Azure OpenAI, Amazon Bedrock, Google Gemini / Vertex, Mistral, Groq, Cerebras, xAI, DeepSeek, OpenRouter, Together, Fireworks, Hugging Face, Cloudflare / Vercel gateways. The list is read from the pi catalog, so upgrading pi brings new providers |
| **Custom** | pi `models.json` shape: `baseUrl`, `api` (wire protocol), auth, headers, `models[]` with limits, cost and compat flags. Covers vLLM, Ollama, LM Studio, LiteLLM and internal gateways |
| **Model overrides** | pi `modelOverrides` for built-in models (sampling, prompt cache, input limits) |

## Binding, allowlist and budget

- **Binding**: each runtime agent has a default provider/model (`AgentModelBinding`), which can be overridden per project.
- **Allowlist**: a model allowlist limits what can be bound.
- **Budget**: budgets are enforced from pi's per-message `usage.cost`. Custom models declare their own cost.

## At job launch

1. The worker writes a job-scoped `models.json` containing only the provider the job needs.
2. It passes only that provider's credentials, as environment variables.
3. The `egress-proxy` allowlist is derived from the configured provider endpoints.

**Not allowed for the runtime**: consumer OAuth subscription logins (Claude Pro/Max, ChatGPT, Copilot tokens).

Types: `LlmProviderConfig`, `AgentModelBinding` in [`packages/runtime-sdk`](../../../packages/runtime-sdk/src/index.ts). How-to: [configure LLM providers](../../guides/configure-llm-providers.md).
