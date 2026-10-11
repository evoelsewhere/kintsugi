# ADR-0020: The worker reaches Docker only through a socket proxy, with an image allowlist

- Status: Superseded by [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md): the worker starts no containers and has no Docker API access. Previously amended by [ADR-0028](0028-remove-rulebook-single-document-repo.md): there are no rulebook runners, so no runner image allowlist.
- Date: 2026-10-09
- Decision register: D32

## Context

`kintsugi-worker` starts every runtime job container through the Docker API (ADR-0004), and rulebook runners/comparators in their own allowlisted images (ADR-0013 amendment). Mounting `/var/run/docker.sock` into the worker amounts to root on the host: anything that can talk to the Docker API can start privileged containers and mount arbitrary paths. The register's proposal narrowed this; this ADR accepts it.

## Decision

- **The worker never mounts the Docker socket directly.** A `docker-socket-proxy` (tecnativa/docker-socket-proxy, already in `deploy/compose`) exposes a restricted HTTP endpoint that allows only:
  - container lifecycle: create, start, wait, stop, logs, inspect, delete;
  - images: list and pull (needed to fetch runner images).
  - Everything else (volumes, networks, exec, plugins, host config beyond the allowed fields) stays denied.
- **Image allowlist** (enforced in the worker, not just the proxy):
  - runtime jobs (pi): only `kintsugi-runner:<kintsugi-version>`;
  - rulebook runners and custom comparators: only images on `KINTSUGI_JOB_IMAGE_ALLOWLIST` (ADR-0013).
  - Anything else is refused before a container is created.
- **Mount allowlist**: the worker refuses any mount outside the job directory. `/src` is read-only, `/out` is the only writable path (ADR-0004).
- **Hardening is unchanged** (ADR-0004): non-root user, read-only root filesystem, `cap-drop ALL`, `no-new-privileges`, CPU/memory/wall-clock limits, gVisor (`--runtime=runsc`) when the host provides it, job network limited to `kintsugi-app` and `egress-proxy`.
- The proxy listens only on the internal `backend` network; it is never published to the host.

## Consequences

- A compromised worker can still create containers with the allowed images and mounts — it is not a full sandbox boundary. The allowlists bound the damage: no privileged containers, no arbitrary host mounts, no arbitrary images.
- Runner images must be built and versioned with Kintsugi; upgrading pi or a rulebook runner means shipping a new pinned image (ADR-0018).
- Host requirements: Docker 24+ (26+ for volume subpaths), Compose v2 (D33).
- If an installation later needs stronger isolation, the same worker code can target a different container API (e.g. Podman socket with the same restrictions) without changing the job contract.

## Alternatives considered

- **Direct `/var/run/docker.sock` mount**: rejected; equivalent to root on the host.
- **Docker contexts over TCP with TLS**: rejected; still an unrestricted API, and the certificate management cost buys nothing over the proxy.
- **A containerd/nerdctl shim or a custom privileged helper**: rejected for now; more moving parts than the package's "keep it simple" constraint warrants.
