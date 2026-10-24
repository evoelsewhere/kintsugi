-- core domain: the `telemetry.manage` permission (ADR-0074). The optional export of job spans to an OpenTelemetry
-- backend is stored in admin.installation_setting under the key `telemetry-export` (its headers encrypted) and edited in
-- the portal (Settings → Telemetry export). It is off until an administrator turns it on.

insert into core.permission (code, group_name, description) values
  ('telemetry.manage', 'Settings', 'Change where job spans are exported to (OpenTelemetry)')
on conflict (code) do nothing;

insert into core.role_permission (role_id, permission_code) values
  ('admin', 'telemetry.manage')
on conflict do nothing;
