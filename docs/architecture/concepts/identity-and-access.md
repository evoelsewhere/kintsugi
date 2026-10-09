# Identity and access

Decision: [ADR-0008](../../decisions/0008-authentication.md).

## Authentication

| Phase | Mechanism |
|---|---|
| Now | Local accounts: username + password (argon2id), server-side session in an httpOnly / SameSite cookie, lockout after repeated failures, first admin bootstrapped from `.env` |
| Now | **Personal Access Tokens** for the `kintsugi` CLI and the MCP server: created in the portal, scoped, revocable |
| Later | **Entra ID (OIDC)** behind the same `AuthProvider` interface; MCP OAuth at the same time |

- **Identity model**: identities are stored as `AuthIdentity(provider, subject)` linked to `User`. Adding Entra ID therefore does not change users, roles or audit history.
- **Password reset**: done by an admin; there is no email dependency.

## Authorization

- **Scope**: authorization is per project. There are no tenants (one installation = one organization).
- **Roles**: managed inside Kintsugi, not taken from the identity provider. They follow the RACI model:
  - admin
  - PM
  - core team
  - architect
  - BA
  - dev
  - QC
  - AI practice owner
  - AI champion
  - AI engineer
  - prompt engineer
  - KM lead
  - KM engineer
- **Role-driven permissions**: roles decide who may approve which gate, who may publish assets, and who may change providers and policies.
- **Runtime job tokens**: separate from user identities. They are short-lived, read-only and limited to the job's project.
