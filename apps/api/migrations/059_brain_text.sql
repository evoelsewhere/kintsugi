-- The text index of the Brain (ADR-0097 decision 7): one tsvector for each document, section and card, written by the
-- worker in the same transaction as the tree. It holds lexemes only, never the text: the words of a node stay in Git and
-- are read from there. The configuration is `simple` (no stemming, no stop words), so a function name or an identifier is
-- found as it is written. Weights: A for the title, B for the headings under it and the labels of its document, C for its
-- own lines. A node has no row of its own here when the builder skipped its document (restricted/, _generated/, hidden
-- folders and the files it never indexes).
--
-- There is no foreign key to knowledge.brain_node: an incremental build replaces the rows of a node whose row did not
-- change and keeps the text of the documents it did not read, so a cascade from the node would lose a text nobody rebuilds.
-- The build removes the rows of the nodes it removes and of the documents it reads again; the project's rows go with its
-- index.

create table if not exists knowledge.brain_text (
  project_id text not null references knowledge.brain_source(project_id) on delete cascade,
  node_id text not null,
  tsv tsvector not null,
  primary key (project_id, node_id)
);
create index if not exists brain_text_tsv_idx on knowledge.brain_text using gin (tsv);
