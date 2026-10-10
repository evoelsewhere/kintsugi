-- Drop the agent registry from 003 (ADR-0023): the runtime is a generic kernel and agent
-- definitions travel with each job; no agent ships with Kintsugi. Where definitions are
-- stored is decided with the first agent. Schema: admin.

drop table if exists admin.agent;
