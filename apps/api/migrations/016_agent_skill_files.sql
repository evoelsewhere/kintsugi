-- admin domain: a custom shared skill is a folder, not only SKILL.md (ADR-0035). `content` keeps the
-- SKILL.md text; `files` holds the files beside it (references/, scripts/, assets/, licenses) by
-- path relative to the skill folder, validated by the API.

alter table admin.agent_skill add column if not exists files jsonb not null default '{}'::jsonb;
