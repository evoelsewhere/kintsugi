-- Whether a project's wiki is on (ADR-0097 decision 5). A wiki project's Brain follows the repository's default branch
-- and cannot be turned off or moved while the wiki is on; the rule lives in BrainService.configure.
alter table knowledge.brain_source
  add column if not exists wiki boolean not null default false;
