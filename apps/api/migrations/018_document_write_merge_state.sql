-- workflow domain: a pull request the writer opened no longer stays `pr-opened` for good. The
-- worker watches open pull requests (and review branches pushed without one) and records how they
-- ended: `merged` (its changes are on the default branch, squash and rebase merges included) or
-- `closed` (declined or abandoned without a merge). `updated_at` is when that was seen.

alter table workflow.document_write drop constraint if exists document_write_status_check;
alter table workflow.document_write
  add constraint document_write_status_check
  check (status in ('queued', 'committed', 'pr-opened', 'merged', 'closed', 'unchanged', 'failed'));

-- The worker's watch lists writes that still wait for a review outcome.
create index if not exists document_write_awaiting_review
  on workflow.document_write (project_id, created_at)
  where branch is not null and status in ('committed', 'pr-opened');
