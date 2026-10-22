-- workflow domain: the legacy repositories a run reads (ADR-0052). An application may link several
-- `legacy` repositories; a run mounts every one of them, each pinned at a commit, in its own folder
-- under its source tree.
--
--   job_run.sources   [{ "repositoryId": "...", "commit": "<sha>" }, ...] in mount order; the commit is
--                     added once the run has resolved it. `source_repository_id` and `source_commit`
--                     keep the first one, which the lists and the rebuild trigger read.
--
-- Runs recorded before this migration have no `sources`: they read one repository.

alter table workflow.job_run
  add column sources jsonb check (sources is null or (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 32));
