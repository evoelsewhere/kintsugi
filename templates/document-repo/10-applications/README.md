# `10-applications/`

- Written by: people and Kintsugi, per folder below
- Serves: P1-P4, everything application-specific
- Auto-commit: per folder — see each folder's README

One folder per application in scope, named after its id in `kintsugi.yaml`. *Publish kintsugi.yaml*
in the portal creates the folder of every application of the project with its READMEs, the
migration intent, the requirements record and the application design to fill in; the starter
itself holds no application.

```text
10-applications/<app>/
  README.md        the application's overview
  00-inputs/       INTENT.md, graph/ and telemetry/ attached by people
  01-legacy/       the old system: the assessment, then what is known about each unit
    <module>/<unit>/
  02-modern/       the new system: requirements, the application's design, then each unit's card and design
    <module>/<unit>/
  _generated/      read models rebuilt after a merge
```

Both halves use the same `<module>/<unit>` path, so a unit's two folders sit on the same line of
both trees. A folder whose name starts with `_` belongs to the application, never to a module.

Vocabulary: a **unit** is the thing being migrated (`<app>/<module>/<unit>`); an **item** is only
an entry in the application's catalog (`01-legacy/_catalog/`, `<module>/<item>`).
