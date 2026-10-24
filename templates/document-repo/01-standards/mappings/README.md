# `01-standards/mappings/`

- Written by: people (the project team), through review pull requests
- Serves: P2-P3; the mapping the migrate stage follows per legacy construct or UI pattern
- Auto-commit: no — changes arrive as pull requests

One file per mapping: how a legacy construct or UI pattern becomes its target equivalent. A designer or a converter looks a construct up here instead of deciding again; a construct with no mapping is raised as an open question in the unit's design.

| Sample | Kind of mapping |
| --- | --- |
| `legacy-construct.example.md` | the format of any mapping: legacy, target, example, edge cases |
| `search-list-screen.example.md` | a UI pattern: a screen with filters, a search action and a result grid |
| `batch-job.example.md` | a processing pattern: a legacy batch step becomes a target job step |
| `db-object.example.md` | a data construct: a legacy table or file becomes a target table |

The `*.example.md` files teach the format: they are not loaded and not seeded. Copy one to a real name (for example `invoice-grid.md`) and adapt it; name the file after the construct.

## Index

Keep one row per mapping so a reader finds it without opening every file.

| Mapping | Legacy construct | Target construct | Cited by |
| --- | --- | --- | --- |
| <!-- `search-list-screen.md` --> | <!-- a search screen --> | <!-- the UI kit's search page --> | <!-- unit designs --> |
