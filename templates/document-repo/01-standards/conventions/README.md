# `01-standards/conventions/`

- Written by: people (the project team), through review pull requests
- Serves: P2-P3; the target conventions the migrate stage enforces
- Auto-commit: no — changes arrive as pull requests

One file per convention area. Extract the conventions from the scaffolded target repositories; do not invent them: a converter or a reviewer follows only what is written here.

| Area | File | Written when | Samples |
| --- | --- | --- | --- |
| Target architecture: layering, naming, idioms, build and CI | `target.md` | before any code is converted | `target.example.md` |
| UI kit and interaction rules | `ui.md` | before any screen is converted | `ui.example.md` |
| API style: paths, errors, pagination, versioning | `api.md` | before any API unit is designed | `api.example.md` |
| Testing: levels, naming, data, coverage | `testing.md` | before the first unit is built | `testing.example.md` |

The `*.example.md` files teach the format: they are not loaded and not seeded. Copy one to the real name (without `.example`) and fill it from the target repositories.
