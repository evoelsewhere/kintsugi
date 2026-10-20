# Document write path

> Explains how runtime job outputs become document-repository changes.

Only the worker's writer (`services/orchestrator`, [ADR-0019](../decisions/0019-workspace-repo-write-path.md)) commits to the document repo. Callers (the API, runtime job completion) enqueue a `document-write` job; the writer handles one write per document repository at a time:

1. Resolves the project's repository with role `document` and its server credential; fetches its mirror.
2. Validates the files: relative paths without `..`, `.`, empty or `.git` segments, no symbolic links; at most 500 files, 5 MiB per file, 50 MiB per write. A violation fails the write.
3. Commits paths matching `autoCommitPaths` to the default branch, and the other paths to `kintsugi/<agent-or-actor>/<job-id>` (the write id when there is no job). A write marked `reviewAll` (the `understand` stage, whose unit-state proposals are linked to the specifications in the same pull request, [ADR-0031](../decisions/0031-understand-stage-as-is-specification.md)) puts every path on the branch, auto-commit paths included. A file marked `createOnly` (the starter structure of a manifest publish) is dropped when the default branch already has it, so a write never replaces a person's document; a write whose files are all there already ends `unchanged`.
4. Pushes fast-forward only: on a rejection it fetches, rebases and retries (4 attempts in all); a rebase conflict fails the write. It never force-pushes and refuses any ref other than the default branch and `kintsugi/*`.
5. Opens a pull request from the `kintsugi/*` branch with the server's token: GitHub, GitHub Enterprise, GitLab, Gitea and Azure DevOps. `plain-git` servers, servers authenticated by SSH key, and Bitbucket (no adapter yet) keep the pushed branch.
6. Records the outcome in `workflow.document_write`: `committed`, `pr-opened`, `unchanged` (the files were already identical) or `failed` with a redacted error ([data model](data-model.md#document-writes)).
7. Watches the review. A write on a `kintsugi/*` branch is looked at every minute (`pr-opened`, or `committed` with a branch and no pull request) until it ends: `merged` when its branch commit is part of the default branch, or, for a pull request, when the server reports it merged (squash and rebase merges leave no ancestry in git); `closed` when the server reports it declined or abandoned. A write with no pull request can only be seen as `merged` through git. A server that cannot be read leaves the write waiting.
