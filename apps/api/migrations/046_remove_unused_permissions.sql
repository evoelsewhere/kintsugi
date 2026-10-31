-- The first identity seed (002_identity.sql) added nine permissions for capabilities that were never built: no route,
-- guard or service checks them, yet Roles & Permissions offered them and the contribute and user roles described them.
-- They are removed with their grants (a feature that enforces one adds it back by migration, ADR-0008), and the two
-- role descriptions say what the roles can do today; a description an admin has changed is kept. Schema: core.

create schema if not exists core;

delete from core.role_permission
 where permission_code in ('subroles.manage', 'resource-policy.manage', 'agents.publish', 'skills.publish', 'mcp.publish',
                           'monitoring.team.view', 'catalog.consume', 'secrets.create', 'usage.report');

delete from core.permission
 where code in ('subroles.manage', 'resource-policy.manage', 'agents.publish', 'skills.publish', 'mcp.publish',
                'monitoring.team.view', 'catalog.consume', 'secrets.create', 'usage.report');

update core.role
   set description = 'Use the Kintsugi CLI and an AI client with the projects one has access to, and manage one''s own member tokens'
 where id = 'user' and description = 'Consume catalogs, create secrets, report usage';

update core.role
   set description = 'The same permissions as User until an admin grants more'
 where id = 'contribute' and description = 'Publish shared agents/skills/MCP, view team monitoring';
