# LLM configuration (runtime only)

Decision: [ADR-0009](../../decisions/0009-llm-provider-config.md). This covers LLMs used by the **Kintsugi Runtime**. Members' harnesses use their own licenses and are not configured here.

## Provider registry

| Kind | What it covers |
|---|---|
| **Built-in** | Every provider in the pinned pi-ai catalog, e.g. Anthropic, OpenAI, Azure OpenAI, Amazon Bedrock, Google Gemini / Vertex, Mistral, Groq, Cerebras, xAI, DeepSeek, OpenRouter, Together, Fireworks, Hugging Face, Cloudflare / Vercel gateways. The list is read from the pi catalog, so upgrading pi brings new providers |
| **Custom** | pi `models.json` shape: `baseUrl`, `api` (wire protocol), auth, headers, `models[]` with limits, cost and compat flags. Covers vLLM, Ollama, LM Studio, LiteLLM and internal gateways |
| **Model overrides** | pi `modelOverrides` for built-in models (sampling, prompt cache, input limits) |

## Binding, allowlist and budget

- **Binding**: a default provider/model per runtime agent id (`AgentModelBinding`), which can be overridden per project. Agents are supplied per job ([ADR-0023](../../decisions/0023-runtime-as-generic-agent-kernel.md)), so a binding may name an agent id that does not exist yet.
- **Allowlist**: a model allowlist limits what can be bound.
- **Budget**: budgets are enforced from pi's per-message `usage.cost`; a job over its `maxCostUsd` limit ends as `job.failed` (`budget`). Custom models declare their own cost.

## At job launch

1. The launcher registers only the provider and models the job needs with pi, in memory: no `models.json` or `auth.json` is written.
2. It passes only that provider's credentials to pi, in memory (never to scripts, never on disk); providers that need process environment variables are not supported for in-worker jobs yet.

**Not allowed for the runtime**: consumer OAuth subscription logins (Claude Pro/Max, ChatGPT, Copilot tokens).

Types: `LlmProviderConfig`, `AgentModelBinding` in [`packages/runtime-sdk`](../../../packages/runtime-sdk/src/index.ts). How-to: [configure LLM providers](../../guides/configure-llm-providers.md).
