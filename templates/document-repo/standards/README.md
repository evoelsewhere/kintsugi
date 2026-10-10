# Standards

The project's own decisions about the target, written as plain Markdown. There is no schema and no maturity: a standard applies once it is merged. Runtime agents read this folder; members and their plugins follow it; reviewers enforce it.

| Path | Content |
|---|---|
| `conventions/` | Target conventions: layering, naming, idioms, UI kit, build and CI. Extract them from the scaffolded target repos; do not invent them. |
| `mappings/` | How a legacy construct or UI pattern becomes its target equivalent, one file per mapping. |
| `review-rules.md` | The rules reviewers enforce, each with a short id that review findings cite. |

Changing a standard is a pull request to this repo. Files ending in `.example.md` are samples: copy them to a real name and adapt them.
