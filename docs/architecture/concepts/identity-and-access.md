# Identity and access

Decision: [ADR-0008](../../decisions/0008-authentication.md).

## Authentication

| Phase | Mechanism |
|---|---|
| Now | Local accounts: username + password (argon2id), server-side session in an httpOnly / SameSite cookie, lockout after repeated failures, first admin bootstrapped from `.env` |
| Now | **Personal Access Tokens** for the `kintsugi` CLI and the MCP server: created in the portal, scoped, revocable |
| Later | **Entra ID (OIDC)** behind the same `AuthProvider` interface; MCP OAuth at the same time |

- **Identity model**: identities are stored as `AuthIdentity(provider, subject)` linked to `User`. Adding Entra ID therefore does not change users, access-role assignments or audit history.
- **Password reset**: done by an admin; there is no email dependency.

## Authorization

- **Installation scope**: there are no tenants (one installation = one organization). Access-role permissions are installation-wide; project scope is checked separately.
- **Access roles**: `admin`, `contribute`, and `user`, plus admin-defined access sub-roles, are permission bundles managed in Admin → Members & Permissions. They are not sourced from the identity provider.
- **Project roles (RACI)**: project responsibilities use the vocabulary in `@kintsugi/domain`. Assignment per project membership is planned with M0 project persistence; project roles do not grant installation permissions and are not yet persisted.
- **Authorization checks**: access-role permissions gate installation actions such as publishing assets or changing providers and policies. Project roles describe RACI responsibility, including gate approvals; they are not currently API permission grants.
- **Project Access**: an explicit grant per project and member (Project → Project Access); no role gives it. It governs the member API that the CLI and AI clients use (`/api/member/v1`), the browser authorization of a client, recording the decisions a stage run waits for, and every project route of the portal: the routes under `projects/:id` (documents, stage results, the item catalog, design, build, job runs and the Brain) and the document writes of one project answer 403 "Project Access is required" without a grant, an administrator included (administrators grant themselves with `project.access.manage`). An unknown project answers 403 too, since no grant can exist on it. The cross-project lists (`GET /api/job-runs`, `GET /api/document-writes`) show only the projects the member holds a grant on ([ADR-0099](../../decisions/0099-wiki-collaboration-and-access.md) decision 4). Project Access is all or nothing per project: it is the read boundary of everything in the document repository, and the wiki adds no per-page view restriction. An installation serves one organization ([ADR-0006](../../decisions/0006-self-hosted-package.md)).
- **Wiki permissions**: `wiki.comment`, `wiki.write`, `wiki.publish` and `wiki.manage` are in the catalog under the group Wiki and held by the `admin` access role; administrators grant them to other access roles. Reading needs no code. Nothing checks them yet: the wiki module enforces them from Phase 2 of the [wiki roadmap](../../research/confluence-parity/90-roadmap.md) on ([ADR-0099](../../decisions/0099-wiki-collaboration-and-access.md) decision 5).
- **Runtime job tokens**: separate from user identities. They are short-lived, read-only and limited to the job's project.
