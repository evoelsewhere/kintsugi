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
- **Runtime job tokens**: separate from user identities. They are short-lived, read-only and limited to the job's project.
