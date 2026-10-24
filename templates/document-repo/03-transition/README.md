# `03-transition/`

- Written by: people (the architecture leads and the data team)
- Serves: P2-P4; what bridges the legacy and the target systems
- Auto-commit: no — content arrives as pull requests

What belongs to neither system alone but to the move from one to the other:

| File or folder | Content |
| --- | --- |
| `coexistence.md` | how the legacy and target systems run side by side during the migration: routing, bridges and adapters, data ownership, the cut-over of each unit and the rollback |
| `data-migration.md` | the data migration plan: sources and targets, the order, the mapping rules, the reconciliation and the rollback |
| `shared-data/` | data definitions several applications share: master data, reference codes, common formats, one file each |

Read `coexistence.md` first: it fixes which system owns what at each point in time, and `data-migration.md` follows from it. The permanent interfaces of the target are in `../02-architecture/integration.md`; this folder holds only what disappears when the legacy system does.

These files start as skeletons: replace the guidance in each section with the project's content and delete a section that does not apply. Kintsugi does not generate or validate them.
