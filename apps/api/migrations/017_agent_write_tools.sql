-- admin domain: the kernel's `outputs_write` tool became pi's own `write` and `edit` tools
-- (ADR-0037). A stored custom agent that allows `outputs_write` is rewritten to allow both;
-- the name in its instructions becomes `write`. Built-in agents ship in the package, not here.

update admin.agent
   set package = regexp_replace(replace(package::text, 'outputs_write]', 'write, edit]'), 'outputs_write', 'write', 'g')::jsonb
 where package::text like '%outputs_write%';

update admin.agent_version
   set package = regexp_replace(replace(package::text, 'outputs_write]', 'write, edit]'), 'outputs_write', 'write', 'g')::jsonb
 where package::text like '%outputs_write%';
