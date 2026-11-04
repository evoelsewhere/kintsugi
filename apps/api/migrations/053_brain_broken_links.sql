-- The links of the indexed documents that point at a Markdown file the repository does not have (ADR-0097 decision 6):
-- an array of {from, target}, at most BRAIN_MAX_BROKEN_LINKS, computed again in full by every build. A first step in
-- Phase 1: when the build keeps its raw references (knowledge.brain_ref), the same answer is derived from them and
-- GET /projects/:id/brain/broken does not change.
alter table knowledge.brain_source
  add column if not exists broken jsonb not null default '[]'::jsonb;
