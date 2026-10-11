# ADR-0004: One Docker container per runtime job, with a pi SDK runner inside

- Status: Accepted. Amended by [ADR-0013](0013-composable-open-rulebook.md): rulebook runners use their own allowlisted images (see Amendment). Amended by [ADR-0028](0028-remove-rulebook-single-document-repo.md): rulebook runners are removed. Amended by [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md): runtime jobs run in job workspaces of the worker, not in per-job containers; read-only sources, a single writable output, credentials never on disk and the worker-side output checks stand.
- Date: 2026-10-09

## Context
pi has no sandbox and no permission system, and its "project trust" is explicitly not a security boundary. Legacy repositories are untrusted input and may contain prompt-injection payloads. The package must stay simple: Docker only, no Kubernetes.

## Decision
- Every Kintsugi Runtime job runs in its own ephemeral **Docker container** from the `kintsugi-runner` image. `kintsugi-worker` starts it through the Docker API.
- Inside the container, a thin **Node runner uses the pi SDK** (`createAgentSession`). pi is not embedded in any long-running service.
- The runner streams `JobEvent`s to the Kintsugi job gateway (`kintsugi-app`) using a short-lived job token. Kintsugi tools (`kb.search`, …) call the same gateway.
- Container hardening:
  - non-root user
  - `--read-only` root filesystem
  - `cap-drop ALL`
  - `no-new-privileges`
  - CPU, memory and wall-clock limits
  - gVisor (`--runtime=runsc`) when the host provides it
- Mounts:
  - `/src` is a git checkout, **read-only**.
  - `/out` is the only writable path.
  - The runner never writes to repositories. The worker validates `/out` and commits it to the workspace repo (ADR-0007).
- Network: the container joins an internal network that reaches only `kintsugi-app` and `egress-proxy`. The proxy allowlists the hosts of the configured LLM providers.
- Credentials: only the credentials of the provider the job uses are passed, as environment variables, and are never written to disk.
- pi flags: `--no-context-files`, no auto-discovered extensions, and only the allowlisted `kintsugi` extension. `bash`, `edit` and `write` are off unless an agent definition explicitly allows them.

## Consequences
- The worker needs Docker API access. Restrict it with a socket proxy that allows only container lifecycle calls (D32).
- Node's built-in `fetch` does not honor `HTTPS_PROXY` by default. Verify that `NODE_USE_ENV_PROXY=1` works for pi-ai's providers, or configure an agent explicitly.

## Amendment (ADR-0013)
- **Runtime jobs** (pi) still run only in the `kintsugi-runner` image.
- **Rulebook runners and custom comparators** run in the container image declared by the runner. The image must match the installation **image allowlist** (`KINTSUGI_JOB_IMAGE_ALLOWLIST`).
- **Hardening** is the same for both: non-root, read-only root filesystem, `cap-drop ALL`, `no-new-privileges`, resource limits, gVisor when available.
- **Runner restrictions**:
  - mounts limited to the job directory;
  - network `none` unless the runner declares `allowlist` and the hosts are admin-approved;
  - never any LLM credentials.
- **Worker checks**: the worker refuses images outside the allowlist and mounts outside the job directory.
