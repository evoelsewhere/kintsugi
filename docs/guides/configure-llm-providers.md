# Configure LLM providers for the runtime

These providers are used only by the **Kintsugi Runtime** (pi). Members' harnesses keep their own licenses. Background: [LLM configuration](../architecture/concepts/llm-configuration.md).

## Add a built-in provider

1. Settings → Providers → **Add provider** → **Catalog provider** → choose a provider from the list. The list comes from the pi catalog shipped with this release.
2. Enter the credentials the provider needs. For example:
   - **API key**: Anthropic, OpenAI, Mistral, OpenRouter, …
   - **Azure OpenAI**: base URL or resource name, API version, optional deployment map.
   - **Amazon Bedrock**: region and access keys or bearer token.
   - **Google Vertex**: project, location and service-account JSON, or an API key.
3. Optionally restrict the provider to a set of models (allowlist).
4. Click **Test**. Kintsugi lists the provider's models with the stored key, using the provider's own endpoint and authentication scheme (OpenAI-style, Anthropic, Gemini, Mistral). Providers without a single fixed endpoint (Azure, Bedrock, Vertex, templated gateways) and environment-only credentials are reported as not testable here; they are checked when a runtime job runs.

## Add a custom provider

Use this for vLLM, Ollama, LM Studio, LiteLLM or any internal gateway.

1. Settings → Providers → **Add provider** → **Custom endpoint**.
2. Set:
   - **Provider id** (lowercase letters, digits and dashes; fixed once created);
   - **Wire protocol**, e.g. `openai-completions`, `openai-responses`, `anthropic-messages`;
   - **Base URL**; changing it later requires re-entering the API key;
   - **API key**, plus optional headers. Put credentials in the API key field: header values are stored and shown in plain text.
3. Add models with an id and, optionally, a display name, context window and max output tokens. Input types, reasoning, cost and compat flags are accepted by the API but not yet editable in the portal.
4. Click **Test**.

## Bind models to runtime agents

1. Settings → Providers → **Agent model bindings**: per row, choose a runtime agent from the catalog, the scope **All projects** (the installation default), a provider and one of its models. **Save bindings** confirms with a notification. An agent's own page (Administration → Agents) sets its installation-default binding too.
2. To use a different model for a single project, add a second row for the same agent with that project as its scope; it takes precedence over the default.

## Notes

- **Egress**: the egress proxy allowlist is updated automatically from the configured provider endpoints.
- **Not supported for the runtime**: consumer subscription logins (Claude Pro/Max, ChatGPT, Copilot tokens).
