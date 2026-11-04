-- A write of a wiki page (ADR-0098 decision 3, ADR-0096 decision 5): the page it publishes, so one page has one open
-- write at a time, and the commit that brought its pull request into the default branch, so a file's history can be
-- matched to the write and its actor. Schema: workflow.

alter table workflow.document_write add column if not exists merge_commit text;
alter table workflow.document_write add column if not exists page_path text;
alter table workflow.document_write add column if not exists page_id text;

-- "The open write of this page": queued, or committed or pull-request-opened on a review branch (the open states of
-- document_write_awaiting_review, plus queued).
create index if not exists document_write_open_page
    on workflow.document_write (project_id, page_path)
 where page_path is not null and (status = 'queued' or (branch is not null and status in ('committed', 'pr-opened')));
