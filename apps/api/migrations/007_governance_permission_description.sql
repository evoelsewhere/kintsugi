-- ADR-0028 removes project rule management from Kintsugi: project-specific knowledge lives as
-- plain documents in the project's document repo (standards/, plugins/). No permission code
-- was specific to it; only the governance.manage description still named it. Schema: core.

create schema if not exists core;

update core.permission
   set description = 'Manage policies, reviews and risks'
 where code = 'governance.manage';
