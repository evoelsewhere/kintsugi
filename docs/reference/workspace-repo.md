# Workspace repository

> Status: 🟡 proposed (D29). Layout and file formats are drafts.

Each project has one workspace repo holding everything except source code ([ADR-0007](../decisions/0007-git-as-source-of-truth.md)).

## Layout

```
kintsugi.yaml                 # schemaVersion, applications, repos, pipeline template, policy
inventory/<app>.yaml
assessment/<app>/scorecard.md
architecture/adr/NNNN-*.md
knowledge/as-is/<app>/...     # AS-IS documents (generated + human-written)
knowledge/to-be/...
tasks/<work-item-id>.md       # task packs
reviews/<work-item-id>/...    # gate-reviewer records
deliverables/<phase>/...      # detail designs, test reports, ... (large binaries: D31)
.kintsugi/assets/             # project-specific skills, task-pack templates, runtime agent overrides
```

## `kintsugi.yaml` (draft)

```yaml
schemaVersion: 1
project:
  id: billing-modernization
  name: Billing modernization
applications:
  - id: billing-web
    disposition: refactor          # 7R
    repos:
      - server: github-main        # GitServer id registered in the installation
        path: org/billing-web-legacy
        role: as-is
      - server: azdo-internal
        path: Billing/_git/billing-web
        role: to-be
pipeline:
  template: refactor               # pipeline template per 7R
gates:
  G4:
    require: [build, static-check, gate-reviewer, human-approval]
autoCommitPaths:
  - tasks/**
  - knowledge/**/generated/**
policy:
  harnesses: [copilot, claude-code]
  requireCommitTrailer: true
```

## Commit conventions

| Who | Branch | Author | Trailers |
|---|---|---|---|
| Kintsugi worker (PR) | `kintsugi/<agent>/<job-id>` | `kintsugi-bot` | `Kintsugi-Job: <id>`, `Kintsugi-Agent: <agent>@<version>` |
| Kintsugi worker (auto-commit) | default branch | `kintsugi-bot` | same as above |
| Members | own branches | the member | `Assisted-by: <harness>` when AI-assisted |

## Open questions (D29)

- A dedicated repo (proposed) or a `kintsugi/` folder inside an existing repo.
- Which paths are auto-committed by default.
