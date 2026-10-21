-- admin domain: every application is rebuilt, so an application no longer records a strategy.

alter table admin.application drop column if exists disposition;
