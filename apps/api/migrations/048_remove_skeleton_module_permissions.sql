-- The fifteen skeleton modules that kept their writes in memory are removed (ADR-0095). Two permissions were checked by
-- them only: setup.manage (connectors, harnesses, templates, project build) and governance.manage (policies, reviews,
-- risks). No route, guard or service checks them any more, so they are removed with their grants, as 046 did for the
-- permissions of features never built; a feature that enforces one adds it back by migration (ADR-0008).
-- workitems.manage stays: the stage decisions check it. Schema: core.

create schema if not exists core;

delete from core.role_permission where permission_code in ('setup.manage', 'governance.manage');

delete from core.permission where code in ('setup.manage', 'governance.manage');
