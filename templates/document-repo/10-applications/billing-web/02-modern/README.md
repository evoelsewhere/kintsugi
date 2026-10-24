# `10-applications/billing-web/02-modern/`

- Written by: people, members in their harness, and the Kintsugi runtime (`understand` proposes the unit cards, `design` writes the design sets)
- Serves: P2-P4, the development of the new system; input to gate G2
- Auto-commit: each unit's `README.md` and `task.md`; everything else arrives as pull requests

At the top, what is specific to this application:

| File or folder | Content |
| --- | --- |
| `requirements.md` | the requirements record: `REQ-` sections with `derivedFrom` rule ids |
| `design.md` | the target design specific to this application: its components and target repositories, the interfaces between them, data ownership, and the mapping of the AS-IS modules to the components (the common design is in `02-architecture/`) |
| `_design/<set>/` | the documents of the design sets the project scoped to the application (`scope: application`) |

Below it, one folder per unit, `<module>/<unit>/`:

| File or folder | Content |
| --- | --- |
| `README.md` | the unit's card: identity, kind, source → target, wave, state, the design files it waives |
| `<set>/` | the unit's documents of one design set of `01-standards/templates/` (for example `screen/`, `api/`, `batch-job/`, `test/`) |
| `task.md` | the task pack a member implements from |

Module notes sit beside the module's units (`<module>/TRANSFORMATION_NOTES.md`). What is known about
a unit is on the same `<module>/<unit>/` path in `../01-legacy/`.

## Requirements record

Each requirement is a Markdown section; the source rules are named on its `derivedFrom` line:

```markdown
## REQ-INV-001: Invoice search returns gross amounts

The invoice search returns amounts including tax.

**derivedFrom:** RULE-invoice-amount-001, RULE-invoice-tax-002
```

A unit's `trace.md` (in `01-legacy/`) links the requirement ids it implements under `Requirements`.

`_example.example/` holds a sample unit card; it is not loaded and not seeded.
