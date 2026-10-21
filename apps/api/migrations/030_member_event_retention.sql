-- Keep the Coding Agent Workflow event replay window queryable and support physical expiry cleanup.

create index workflow_member_event_retention_idx
  on workflow.member_event (created_at);
