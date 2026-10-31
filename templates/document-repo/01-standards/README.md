# `01-standards/`

- Written by: people (the project team), through review pull requests
- Serves: P2-P3; the factory that the migrate stage runs in
- Auto-commit: no — changes arrive as pull requests

The project's own decisions about the target, written as plain Markdown. There is no schema and no maturity: a standard applies once it is merged. Runtime agents read this folder; members and their plugins follow it; reviewers enforce it.

| Path | Content | Used by |
| --- | --- | --- |
| `conventions/` | Target conventions: layering, naming, idioms, UI kit, API style, testing, build and CI. Extract them from the scaffolded target repos; do not invent them. | the designers, the members' harnesses, the reviewers |
| `mappings/` | How a legacy construct or UI pattern becomes its target equivalent, one file per mapping. | the designers and the members' harnesses |
| `templates/` | The project's design sets: the format and the required content of the design documents of every unit, one set per unit kind (screen, API, batch job, report) and a test set, as templates with checks. | the runtime's design stage, the design checks, the portal |
| `review-rules.md` | The rules reviewers enforce, each with a short id that review findings cite. | the runtime's review and the human reviewers |

## Order of authority

When two documents disagree, the earlier one wins, and the disagreement is fixed in the same pull request:

1. an accepted decision in `../02-architecture/adr/`
2. `../02-architecture/` (blueprint, components, security, quality attributes)
3. `conventions/`
4. `mappings/`
5. a unit's design

## Changing a standard

Changing a standard is a pull request to this repo. A change that affects designs already written raises the `version` of its design set (or profile), so the portal shows the older designs as stale. Files whose name contains `.example` are format samples: copy them to a real name and adapt them. They are not loaded and not seeded.
