# Standards

- Written by: people (the project team), through review pull requests
- Serves: P2-P3; the factory that the migrate and verify stages run in
- Auto-commit: no — changes arrive as pull requests

The project's own decisions about the target, written as plain Markdown. There is no schema and no maturity: a standard applies once it is merged. Runtime agents read this folder; members and their plugins follow it; reviewers enforce it.

| Path | Content |
|---|---|
| `conventions/` | Target conventions: layering, naming, idioms, UI kit, build and CI. Extract them from the scaffolded target repos; do not invent them. |
| `mappings/` | How a legacy construct or UI pattern becomes its target equivalent, one file per mapping. |
| `design/` | The project's design sets: the format and the required content of the design documents of every unit (basic design, detail design, ...), as templates with checks. |
| `review-rules.md` | The rules reviewers enforce, each with a short id that review findings cite. |

Changing a standard is a pull request to this repo. Files whose name contains `.example` are format samples: copy them to a real name and adapt them. They are not loaded and not seeded.
