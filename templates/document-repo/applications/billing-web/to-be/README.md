# `applications/billing-web/to-be/`

- Written by: people and the Kintsugi runtime (the target specification; the writers are planned)
- Serves: P2 target specification for this application; input to gate G2
- Auto-commit: no — content arrives as pull requests

| File | Content |
| --- | --- |
| `requirements.md` | the requirements record: `REQ-` sections with `derivedFrom` rule ids |
| `design.md` | the target design specific to this application: its components and target repositories, the interfaces between them, data ownership, and the mapping of the AS-IS modules to the components (the common design is in `architecture/`; each unit's design is under its `design/<set>/`) |

## Requirements record

Each requirement is a Markdown section; the source rules are named on its `derivedFrom` line:

```markdown
## REQ-INV-001: Invoice search returns gross amounts

The invoice search returns amounts including tax.

**derivedFrom:** RULE-invoice-amount-001, RULE-invoice-tax-002
```

A unit's `understanding/trace.md` links the requirement ids it implements under `Requirements`.
