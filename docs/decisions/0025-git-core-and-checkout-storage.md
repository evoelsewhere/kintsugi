# ADR-0025: Git core package and Kintsugi-managed checkout storage

- Status: Accepted
- Date: 2026-10-10
- Decision register: D45

## Context

Projects register Git servers and repositories (ADR-0007, ADR-0019). The worker clones and fetches them, gives each runtime job a read-only `/src` (ADR-0004), and commits results to the workspace repo. Before any of this is built, two questions need an answer:

- **Where do checkouts live, and who owns them?** One option is to let users point Kintsugi at folders they already have on disk. The other is to let Kintsugi clone from the repository URL into storage it manages. The compose draft splits storage across two named volumes (`git-cache`, `jobs-data`), and the admin cannot choose where on the host they live.
- **How does Kintsugi talk to Git?** Clone, fetch, worktrees, LFS, partial clone and SSH must all work against GitHub, Azure DevOps, GitLab, Bitbucket, Gitea and plain Git servers. Pull requests and repository listings need each provider's API.

Constraints:

- Runtime jobs must see a fixed, read-only snapshot.
- Only the worker writes to the workspace repo.
- Credentials are stored encrypted and never written to disk in plaintext (ADR-0009).
- No new infrastructure services.

## Decision

### Kintsugi owns its checkouts

- Users register a **repository URL and a credential**, never a local folder. Kintsugi clones it in the background when the repository is saved, and shows per-repository status in the portal: `cloning`, `ready` or `error`, plus the last synced commit.
- Code that is not on a Git server can be **imported once**: Kintsugi reads a folder or archive and creates an internal repository in its storage. From then on it is a repository like any other; the original folder is not used again.
- Members keep their own clones on their own machines (Claude Code, Copilot, …). Kintsugi's checkouts are server-side only.

### One data directory, chosen at install time

- All Git and job data lives in **one directory**, set by `KINTSUGI_DATA_DIR` in `.env`.
  - Compose mounts it as the named volume `kintsugi-data`, backed by that host directory (`local` driver, bind option). This replaces the `git-cache` and `jobs-data` volumes.
  - Runner containers still receive volume subpaths, as before.
  - `KINTSUGI_DATA_DIR` is required, so the admin always decides which disk the data lands on.
- In development without Docker, the default is `./.kintsugi/data` (gitignored).
- The layout is owned by `packages/git` and the worker; nobody edits it by hand:

```
<data>/git/mirrors/<server-id>/<repo-id>.git    bare mirror per registered repository
<data>/git/workspaces/<project-id>/             the worker's clone of the workspace repo (writer only)
<data>/jobs/<job-id>/src                        per-job worktree at a fixed commit, mounted read-only
<data>/jobs/<job-id>/out                        per-job output
<data>/ssh/known_hosts                          pinned SSH host keys
```

- **Mirrors and worktrees.**
  - Each repository has exactly one bare mirror. It is updated by polling (D30) or a webhook.
  - A job's `/src` is a `git worktree` of the mirror, checked out at the commit recorded on the job, so re-running a job sees the same code.
  - Worktrees are removed when the job ends; mirrors are pruned when the repository is deleted.
- Large legacy repositories use partial clone (`--filter=blob:none`). LFS objects are fetched on demand (D31).

### Git core: `packages/git` over the system `git` binary

- A new package, **`packages/git`**, holds every Git operation Kintsugi performs: ls-remote, mirror clone and fetch, worktree add and remove, commit, push, and the storage layout above.
  - It runs the system `git` through `execFile`: no shell, argument arrays, a timeout on every call.
  - It does not use libgit2 or isomorphic-git, because they lack full support for partial clone, LFS, worktrees and SSH, and members' tools use real Git anyway.
- **Credentials never touch the repository or the disk in plaintext:**
  - HTTPS tokens are passed for one invocation through an inline credential helper that reads an environment variable of that call; the helper only answers `get`. Tokens are never put in URLs, remote config, the process arguments or a credential store, and they are redacted from error messages.
  - SSH keys are written to a mode-0600 temporary file that lives only for the invocation. `GIT_SSH_COMMAND` sets `IdentitiesOnly=yes` and `StrictHostKeyChecking=yes`, and uses `<data>/ssh/known_hosts`.
  - The host key is shown to the admin and pinned when the server is registered.
- **Hardened environment on every call:**
  - `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1` and an isolated `HOME`.
  - `core.hooksPath` pointed at an empty directory, so repository hooks never run.
  - `protocol.allow=never` with `https` and `ssh` allowed; `file` is allowed only for imports.
  - Submodules are not fetched recursively by default.
- **Provider operations** (list repositories, open pull requests, comment, register webhooks) are **REST adapters** in the same package. Their priority follows ADR-0007: GitHub, then Azure DevOps, GitLab, Bitbucket and Gitea. A server without an adapter still gets sync, and its writes fall back to branches (ADR-0019).
- **Images ship the Git CLI tools:** `kintsugi-app` and `kintsugi-worker` include `git`, `git-lfs`, `openssh-client` and `ca-certificates`.
  - Git 2.40 or later is required, and startup checks the version.
  - Provider CLIs (`gh`, `az`, `glab`) are **not** used.
- Callers:
  - the worker: sync, the writer, and job worktrees;
  - the API: only for "Test access" when a server or repository is registered (`ls-remote`).

## Consequences

- **Setup:** setup is "paste a URL and a token". Checkouts are consistent, reproducible per job and never disturbed by humans. Backup stays Postgres-only, because `<data>` can be rebuilt from Git, except for imported repositories, which the admin must back up or push to a Git server.
- **Install:** one more required variable (`KINTSUGI_DATA_DIR`); the installation guide and configuration reference document disk sizing for it.
- **Launcher:** the launcher mounts only subpaths under `<data>/jobs` and never another host path.
- **Tests:** `packages/git` is tested against local bare repositories, using `file://` in tests only. Integration tests against real providers are opt-in.
- **Follow-up work:**
  - persist Git servers and repositories with encrypted credentials;
  - the orchestrator sync job;
  - the "Test access" endpoint;
  - provider adapters, starting with GitHub.

## Alternatives considered

- **Users point Kintsugi at existing local folders.** Rejected:
  - folders change under Kintsugi (uncommitted edits, branch switches), so jobs are not reproducible and the single write path (ADR-0019) breaks;
  - each folder needs its own compose mount, and paths differ between host and container.
- **Separate named volumes, as in the draft.** Rejected: the admin cannot choose the disk, and Git and job data share a lifecycle anyway.
- **libgit2 or isomorphic-git.** Rejected: partial clone, LFS, worktrees and SSH are incomplete, and behaviour diverges from the Git that members use.
- **Provider CLIs (`gh`, `az`, `glab`).**
  - Rejected because each CLI has its own authentication and config files on disk, its version drifts from the API, and it adds image surface.
  - REST adapters share one credential path with Git.
