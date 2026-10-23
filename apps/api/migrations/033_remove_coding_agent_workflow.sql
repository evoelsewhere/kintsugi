-- Removes the Coding Agent Workflow and the pull request review (ADR-0067): member credentials and
-- connections, task and snapshot projections, provider observations, reviews and gate publications, the
-- GitHub App configuration of a Git server, and the permissions that guarded them.
--
-- Kept: explicit Project Access (admin.project_access and project.access.manage), which stage decisions use,
-- and the workflow event log and outbox (workflow.member_transition, member_event, member_event_cursor, outbox)
-- that stage decisions record into.

-- Reviews, gate publications and provider observations (children first).
drop table if exists workflow.gate_publication cascade;
drop function if exists workflow.guard_gate_publication_evidence_immutable();
drop table if exists workflow.member_review cascade;
drop table if exists workflow.member_task_pull_request cascade;
drop table if exists workflow.member_provider_actor_mapping cascade;
drop table if exists workflow.member_provider_observation cascade;
drop table if exists workflow.member_provider_sync_watermark cascade;
drop table if exists workflow.member_provider_delivery cascade;

-- Task and snapshot projections.
drop trigger if exists member_task_application_configuration on admin.application;
drop table if exists delivery.member_snapshot_lease cascade;
drop table if exists delivery.member_snapshot_cursor cascade;
drop table if exists delivery.member_snapshot_source cascade;
drop table if exists delivery.member_snapshot cascade;
drop table if exists delivery.member_task_projection cascade;
drop table if exists delivery.member_task_index_issue cascade;
drop table if exists delivery.member_task_index cascade;
drop function if exists delivery.prevent_member_snapshot_manifest_update();
drop function if exists delivery.prevent_member_snapshot_source_update();
drop function if exists delivery.invalidate_member_task_configuration();

-- Credentials and browser-authorized connections.
drop table if exists core.member_connection_refresh_token cascade;
drop table if exists core.member_authorization_code cascade;
drop table if exists core.member_connection_project cascade;
drop table if exists core.member_token_project cascade;
drop table if exists core.member_token cascade;
drop table if exists core.member_connection cascade;

-- GitHub App configuration and webhook secrets of a Git server.
alter table admin.git_repository drop constraint if exists git_repository_id_server_id_unique;
alter table admin.git_server
  drop constraint if exists git_server_github_app_config_check,
  drop column if exists github_app_id,
  drop column if exists github_installation_id;
delete from admin.git_secret
 where secret_id like 'git-server:%:github-app-private-key'
    or secret_id like 'git-server:%:github-webhook-secret';

-- Permissions of the removed feature.
delete from core.role_permission
 where permission_code in ('member.read', 'tokens.manage-own', 'gates.view', 'security.manage');
delete from core.permission
 where code in ('member.read', 'tokens.manage-own', 'gates.view', 'security.manage');
