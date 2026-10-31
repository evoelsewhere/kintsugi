-- The Brain keeps the last commit that changed each indexed document (ADR-0091); a folder and the root keep the
-- latest of what they hold. Sections and cards have none: history is kept per file.
alter table knowledge.brain_node
  add column changed_commit text,
  add column changed_at timestamptz,
  add column changed_subject text;
