# `02-architecture/adr/`

- Written by: people (architects and tech leads)
- Serves: P2-P4; records the decisions behind gate G2 and later gates
- Auto-commit: no — records arrive as pull requests

Architecture decision records of this project, one file per decision, named `<number>-<short-title>.md` (`0001-use-a-modular-monolith.md`) and numbered in order of decision. A record states the context, the decision taken and why; a record is never edited once it is accepted: a later decision supersedes it and says so.

`template.md.example` is the format, with a worked example in its comments. Copy it to a real name and adapt it.

## When to write one

- The choice is hard to reverse, or changes how several units are built.
- The choice departs from a convention in `01-standards/` or from the legacy behaviour; a screen or a unit cites the record instead of deciding again.
- Someone will ask "why was it done this way?" in a year.

## Register

Keep one row per record, newest last, so a reader finds the decision without opening every file.

| Number | Title | Status | Decided | Supersedes |
| --- | --- | --- | --- | --- |
| <!-- 0001 --> | <!-- title --> | proposed / accepted / superseded / rejected | <!-- date --> | <!-- number or - --> |

These records are project content; Kintsugi does not generate or validate them.
