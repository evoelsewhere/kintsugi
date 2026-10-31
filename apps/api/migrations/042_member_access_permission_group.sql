-- ADR-0067 removed the Coding Agent Workflow, but its two permissions stay as the common member base (ADR-0069):
-- member.read lets a member use the Kintsugi CLI and an AI client connection with the projects they have access to,
-- tokens.manage-own lets them manage their own member tokens. Their group and descriptions still named the removed
-- workflow; they now say what the permissions are about. Schema: core.

create schema if not exists core;

update core.permission
   set group_name = 'Member access',
       description = 'Use the Kintsugi CLI and an AI client connection: read the projects one has access to, their documents and member plugins, and record activity'
 where code = 'member.read';

update core.permission
   set group_name = 'Member access',
       description = 'Issue, list and revoke one''s own member tokens for the Kintsugi CLI'
 where code = 'tokens.manage-own';

update core.permission
   set description = 'Manage the connection policy of members'' AI clients and revoke any member connection'
 where code = 'security.manage';
