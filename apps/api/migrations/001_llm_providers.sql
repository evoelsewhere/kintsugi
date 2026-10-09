-- Schema convention: one database, one schema per domain (core · admin · delivery ·
-- monitoring · governance · knowledge · workflow). Every migration creates the schema
-- it owns and qualifies table names explicitly — never rely on search_path.
--
-- admin domain (A4): the LLM provider registry (ADR-0009, data model:
-- LlmProvider(config, secretRef) · LlmModel · AgentModelBinding). Secrets are
-- encrypted with KINTSUGI_SECRET_KEY (AES-256-GCM) and referenced from the config
-- as { secretId } — never returned by the API.

create schema if not exists admin;

create table admin.llm_provider (
  id text primary key,
  kind text not null check (kind in ('builtin', 'custom')),
  config jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin.llm_secret (
  secret_id text primary key,
  provider_id text not null references admin.llm_provider(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now()
);

-- '*' means installation default (project_id is not nullable in the primary key).
create table admin.agent_model_binding (
  agent text not null,
  project_id text not null default '*',
  provider_id text not null references admin.llm_provider(id) on delete cascade,
  model text not null,
  thinking text,
  updated_at timestamptz not null default now(),
  primary key (agent, project_id)
);
