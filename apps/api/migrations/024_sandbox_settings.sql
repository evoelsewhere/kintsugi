-- core domain: the `sandbox.manage` permission (ADR-0055). The settings of the sandbox environment jobs run in (how long
-- a job workspace keeps its checkouts and its results, and the limits of the processes in it) are stored in
-- admin.installation_setting under the key `sandbox` and edited in the portal (Settings → Sandbox).

insert into core.permission (code, group_name, description) values
  ('sandbox.manage', 'Settings', 'Change the settings of the sandbox environment jobs run in')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'sandbox.manage')
on conflict do nothing;
