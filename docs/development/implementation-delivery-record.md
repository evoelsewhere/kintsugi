# Engineering implementation and verification record

Updated: 23 October 2026

This page consolidates the approved design, implementation status, remaining work, known issues, test plan, and recorded evidence for the GHCR/SSH deployment work (the Coding Agent Workflow part was removed, ADR-0067). It replaces the dated implementation notes as the maintained delivery record.

Stable product contracts remain in the ADRs and reference pages linked below. Update this page when implementation status or verification changes; do not create another dated status plan.

## GHCR and SSH deployment

### Intent and constraints

Build Kintsugi app and worker images from the monorepo, publish commit-tagged images to GHCR, and deploy that exact revision to the configured self-hosted Docker Compose host over SSH. Keep the app, worker, and PostgreSQL topology; run app and worker as non-root; mount runtime data read-only in the app and writable by the worker; keep credentials in GitHub Actions secrets and pin the SSH host key.

First-time host provisioning, Docker/firewall/DNS/TLS setup, and installation-specific database/bootstrap values remain operator tasks. The workflow does not add infrastructure or change the single-host Compose architecture.

### Status and verification

The recorded implementation completed the app and worker images, GHCR publishing workflow, commit-SHA tags, SSH deploy gating, configuration validation, pinned known-hosts, Compose bundle transfer, operator setup guide, and ADR decision. Recorded checks built the API/portal and container targets, validated Compose interpolation with temporary non-secret values, parsed the workflow YAML, and reviewed secret handling.

A real deployment still depends on the repository's configured variables/secrets and a provisioned host. See [ADR-0039](../decisions/0039-github-actions-ghcr-deployment.md), the [installation guide](../guides/installation.md), and the [Compose operator guide](../../deploy/compose/README.md) for stable deployment instructions.

## Maintenance

This is the single maintained delivery record for the implementation status and test evidence of the workstreams above. Keep stable architectural decisions in ADRs, exact command contracts in reference pages, and member instructions in the portal guide. Leave detailed agent planning drafts local; do not add another dated plan or progress log to the repository.
