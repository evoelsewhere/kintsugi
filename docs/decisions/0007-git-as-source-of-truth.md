# ADR-0007: Git is the source of truth for code, documents and assets

- Status: Accepted. Amended by [ADR-0043](0054-evidence-bound-pr-continuation.md) for provider-observed pull requests and durable workflow continuation.
- Date: 2026-10-09

## Decision
- All customer code lives in Git repositories. Kintsugi reads them; members change them through branches and PRs.
- Project documents and deliverables also live in Git, in a **workspace repo** per project. This covers inventory, assessment, ADRs, AS-IS/TO-BE docs, task packs, deliverables and project-specific assets. Layout: docs/reference/workspace-repo.md.
- Postgres keeps operational state plus indexes that can be rebuilt from Git (KB chunks, embeddings, entities, edges). It is never the primary copy of a document.
- Runtime outputs reach Git only through the worker. The worker validates the job's `/out` directory, then either commits on a `kintsugi/<agent>/<job-id>` branch and opens a PR, or commits directly to paths configured for auto-commit.
- **Many Git servers, many repositories.**
  - An installation registers any number of Git servers (`GitServer`: kind, base URL, credential). Supported kinds: GitHub (cloud / Enterprise Server), Azure DevOps, GitLab, Bitbucket, Gitea, or plain git.
  - A project references any number of code repos across those servers, plus one workspace repo. Credentials are per server, with an optional per-repository override.
- **Git access.** Plain git over HTTPS or SSH handles clone, fetch and push on every server. Provider adapters add PRs, comments and webhooks, in priority order: GitHub, Azure DevOps, GitLab, Bitbucket, Gitea. A server without an adapter supports sync and branch polling only.
- **Change detection.** Polling is the default; webhooks are used when the Git server can reach the installation.

## Consequences
- Every KB entry and artifact references `repo@commit:path`, which gives traceability for free.
- Large binaries such as KT recordings need Git LFS or a side volume (D31).
- The workspace repo layout becomes a contract and must be versioned (`kintsugi.yaml` `schemaVersion`).
