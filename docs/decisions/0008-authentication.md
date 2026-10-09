# ADR-0008: Local username/password first, Azure AD (Entra ID) later

- Status: Accepted
- Date: 2026-10-09

## Decision
- **Phase 1**:
  - Local accounts with username and password, hashed with argon2id.
  - Server-side sessions in an httpOnly, SameSite cookie.
  - First admin bootstrapped from `.env`.
  - Admins create users. Password reset is done by an admin; no email dependency.
  - Lockout after repeated failures.
- CLI and MCP clients authenticate with **Personal Access Tokens**. Tokens are created in the portal, scoped and revocable.
- All authentication goes through an `AuthProvider` interface. Identities are stored as `AuthIdentity(provider, subject)` linked to `User`, so **Entra ID (OIDC)** can be added later without changing user, role or audit data.
- Roles (RACI) and project membership are managed inside Kintsugi, not taken from the identity provider.

## Consequences
- Password policy, lockout and audit of login events are Kintsugi's responsibility until Entra ID is enabled.
