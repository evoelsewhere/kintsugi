# ADR-0021: Sandboxed child processes with pi-sandbox instead of per-job containers

- Status: Superseded by [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md) before acceptance: jobs run in cross-platform job workspaces, without an OS-level sandbox.
- Date: 2026-10-10
- Decision register: D06, D07, D32
- Amends: ADR-0004 (runtime job isolation)
- Supersedes (on acceptance): ADR-0020

## Context

ADR-0004 required one Docker container per runtime job with hardening (read-only rootfs, cap-drop,
gVisor…) and ADR-0020 constrained the worker's Docker API access through a socket proxy. In practice
the package pays the complexity of container orchestration, socket proxies and runner images for
every job — while the isolation the runtime actually needs is: read-only sources, a single writable
output directory, credentials by environment only, and network limited to the job's LLM provider and
the Kintsugi gateway.

`pi-sandbox` (pi extension, MIT) provides OS-level isolation per pi session: `bash` runs under
`bubblewrap` (Linux) or `sandbox-exec` (macOS) with filesystem + network restrictions, and the
`read` / `write` / `edit` tools are intercepted against the same policy before execution.
Allowances are per session, held in memory, and never written by the agent. Sessions are processes;
closing the session closes the sandbox.

## Decision

- Runtime jobs run as a **sandboxed child process of `kintsugi-worker`**, not in a per-job Docker
  container. The worker spawns `runner` with a per-job environment and a generated `sandbox.json`.
- **Per-job sandbox policy** (defaults, derived from the JobSpec):
  - `allowRead`: the job checkout (`/src`-equivalent), plus the runner's own assets;
  - `allowWrite`: the job output directory (`/out`-equivalent) only;
  - `denyWrite`: `.env*`, `*.pem`, `*.key`, credential files;
  - `allowedDomains`: the job's LLM provider host(s) and the Kintsugi gateway host;
  - no interactive prompts in headless runs — anything outside the policy is blocked.
- The sandbox is **per session**: the session disposes at job end (or budget/timeout), which closes
  the sandbox. There is no long-lived sandbox per project.
- Platform support: `bubblewrap` on Linux (the production host, ADR-0006), `sandbox-exec` on macOS.
  Windows has no OS-level primitive — the extension runs `enabled: false` and the deployment story
  for Windows is "worker must run on Linux/macOS" (already true for the Compose package).
- `ripgrep` is a host dependency of the sandbox (checked at sandbox init).
  - *Update 2026-10-12:* no longer applies. The kernel `grep` tool searches files in-process
    through the path guard (`services/runtime/src/kernel/grep.ts`), so neither the worker host nor a
    job needs `ripgrep`.
- The worker enforces, in addition: never run without the output directory mounted writable,
  never pass credentials on disk, and keep the source checkout read-only at the filesystem level.
- The `kintsugi-runner` image is no longer required for runtime jobs; if one is kept, it is only a
  packaging convenience for dependencies. `docker-socket-proxy` is removed from the package (D32).

## Consequences

- The deployment loses the container boundary: a compromised runner runs as the worker's OS user.
  Compensations: OS-level sandbox on every bash/read/write, no Docker socket at all (smaller attack
  surface than ADR-0020's proxy), network allowlist, and per-job process isolation.
- Simpler operations: no image builds per release for the runner, no socket proxy, faster job start.
- The worker must be able to spawn child processes and clean them up (kill on timeout/abort).
- The sandbox policy must be generated per job from the JobSpec; unlisted domains or paths are
  blocked, so the launcher must compute the provider hosts correctly (ADR-0009).
