# `02-architecture/`

- Written by: people (the architecture leads and the foundation team, with the runtime's architecture support)
- Serves: P2 target specification; decided at gate G2 in the portal
- Auto-commit: no — content arrives as pull requests

Project-level target architecture, shared by every application:

| File | Content |
| --- | --- |
| `blueprint.md` | the target architecture blueprint |
| `poc-plan.md` | the proof-of-concept plan and its evaluation criteria |
| `common/` | the common components every unit's design reuses, one `COM-<AREA>-<NN>.md` each |
| `adr/` | architecture decision records of this project |

How the legacy and the target systems live side by side, and how the data moves, is in `../03-transition/`.
These files are placeholders here: Kintsugi does not generate or validate them.
