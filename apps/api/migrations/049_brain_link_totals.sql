-- The Brain stores at most BRAIN_MAX_LINKS_PER_NODE outgoing links of a node (P-036); a node with more keeps how many it
-- has, so a read can still say "and N more". Zero for every other node: its stored links are all of them.
alter table knowledge.brain_node
  add column outgoing_links integer not null default 0 check (outgoing_links >= 0);
