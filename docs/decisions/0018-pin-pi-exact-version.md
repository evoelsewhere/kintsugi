# ADR-0018: Pin pi to an exact version; track the latest release

- Status: Accepted
- Date: 2026-10-09
- Decision register: D27

## Context

The Kintsugi Runtime embeds pi (`@earendil-works/pi-coding-agent`, ADR-0001) inside the `kintsugi-runner` container. pi moves fast and its SDK, extension API and provider catalog change between releases; the runtime also reads the pinned pi version's provider catalog when translating the LLM provider registry (ADR-0009). The register left open *which* version policy to use.

Forces:

- Reproducibility: a job's behavior must not change because a transitive dependency floated (ADR-0004 job isolation, audit/provenance requirements).
- Currency: the project is pre-release and wants the improvements of new pi releases without an expensive fork or shim layer.
- `AgentRuntime.engine` records the engine as `pi@<version>`; provenance and telemetry need an exact value.

## Decision

- Kintsugi uses the **latest stable pi release** and **pins every `@earendil-works/*` package to an exact version** (no `^`/`~`) in `package.json`, with the lockfile as the second gate. Current pin: **1.3.0** (`@earendil-works/pi-coding-agent`, and the `pi-ai` / `pi-agent-core` packages it pulls in).
- `@earendil-works/pi-codemode`, `pi-mcp` and `pi-telemetry` are direct dependencies of `services/runtime`, pinned to the same version ([ADR-0047](0047-kernel-extensions-codemode-and-http-mcp.md), [ADR-0048](0048-runtime-telemetry-compaction-and-prompt-cache.md)).
- The runner image is built from that pin; `AgentRuntime.engine` reports `pi@<pinned version>`, and the version is recorded in job provenance and telemetry.
- **Upgrades are deliberate**: bump the exact pin in one commit, run the eval suite and the runtime job smoke tests, and record the bump in the commit message. Until the eval suite exists (M1), a manual smoke run of one job per built-in agent is the minimum gate.
- The runner image, not the host, carries pi; nothing on the host or in member harnesses depends on this pin.

## Consequences

- Deterministic job behavior per release of Kintsugi; reproducible incident investigation (`engine` + provenance always name the exact pi version).
- Staying on "latest" means deliberate upgrade work is recurring; that cost is accepted pre-1.0 and will shrink once the eval suite lands.
- The LLM provider catalog read from pi is version-dependent; the provider registry code must read it from the pinned package rather than hard-coding model lists.
- Exact pins for `@earendil-works/*` are enforced by convention in AGENTS.md; a lint/CI check can be added later.

## Alternatives considered

- **Semver ranges (`^`)**: rejected; a floating pi could change tool behavior or the provider catalog between two runs of the same job spec.
- **Fork / vendor pi**: rejected; the extension model (ADR-0001) exists to avoid forks.
- **Pin an older, battle-tested release**: rejected for now; the project is pre-release and prefers current pi features, revisiting stability-first pinning before GA.
