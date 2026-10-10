# Configure LLM providers for the runtime

> **Planned behavior.** This applies once the provider registry is implemented (milestone M0).

These providers are used only by the **Kintsugi Runtime** (pi). Members' harnesses keep their own licenses. Background: [LLM configuration](../architecture/concepts/llm-configuration.md).

## Add a built-in provider

1. Admin → LLM Providers → **Add provider** → choose a provider from the list. The list comes from the pi catalog shipped with this release.
2. Enter the credentials the provider needs. For example:
   - **API key**: Anthropic, OpenAI, Mistral, OpenRouter, …
   - **Azure OpenAI**: base URL or resource name, API version, optional deployment map.
   - **Amazon Bedrock**: region and access keys or bearer token.
   - **Google Vertex**: project, location and service-account JSON, or an API key.
3. Optionally restrict the provider to a set of models (allowlist).
4. Click **Test connection**. Kintsugi runs a minimal completion in a runner container.

## Add a custom provider

Use this for vLLM, Ollama, LM Studio, LiteLLM or any internal gateway.

1. Admin → LLM Providers → **Add custom provider**.
2. Set:
   - **Base URL**;
   - **API** (wire protocol), e.g. `openai-completions`, `openai-responses`, `anthropic-messages`;
   - **Auth**, plus optional headers.
3. Add models with:
   - id;
   - context window and max tokens;
   - input types;
   - reasoning support;
   - **cost**, needed for budgets;
   - compat flags if the server rejects some parameters.
4. Click **Test connection**.

## Bind models to runtime agents

1. Admin → LLM Providers → **Agent bindings**: choose a provider and model per runtime agent id. This sets the installation default. Agents are supplied per job and none ships with Kintsugi yet, so a binding may name an agent that does not exist yet.
2. To use a different model for a single project, override the binding in that project's settings.

## Notes

- **Egress**: the egress proxy allowlist is updated automatically from the configured provider endpoints.
- **Not supported for the runtime**: consumer subscription logins (Claude Pro/Max, ChatGPT, Copilot tokens).
