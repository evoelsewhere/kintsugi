# `applications/billing-web/gates/`

- Written by: people (the approvers named in each record), through review pull requests
- Serves: the application gates G1 (portfolio decision) and G2 (target architecture)
- Auto-commit: never — gate records always arrive as pull requests

One record per application gate. The project-level gates G0 and G3 live in `gates/`; a unit's G4
record lives under the unit's `reviews/` and its `unit.md` points to it.

## Record format

```text
- Decision:            approved / rejected / pending
- Approvers:           names and roles
- Evidence:            paths in this repository supporting the decision
- Date:                YYYY-MM-DD
```

The files here are placeholders with that format; Kintsugi does not generate, validate or
automate them.
