# ADR-0024: Distinguish access roles from project roles

- Status: Accepted. Amended by [ADR-0042](0053-coding-agent-context-and-project-access.md) for project-scoped member-token authorization and the separation of assignment from access.
- Date: 2026-10-10
- Decision register: D44

## Context

Kintsugi uses the word “role” for two distinct concepts. Installation identity and authorization use `core.role`, `core.role_permission`, and `core.user_role` to define permission bundles and assign them to users. The shared domain uses a RACI vocabulary (`ROLES`/`Role`) to describe project responsibilities, performers, and waiver approvers. These concepts have different scope and meaning, but the old names and documentation do not distinguish them. Treating a project responsibility as an access grant (or the reverse) would be unsafe and misleading.

## Decision

Kintsugi keeps **access roles** and **project roles** as separate concepts. Neither is reconciled with, inferred from, or substituted for the other. Literal values can overlap (for example, `admin`, `dev`, or `ba`); equal strings do not create a mapping or make the concepts interchangeable.

- **Access roles** are installation-wide permission bundles. The primary roles are `admin`, `contribute`, and `user`; admins may also define access sub-roles such as `dev`, `ba`, and `tester`. `core.role`, `core.role_permission`, and `core.user_role` store the roles, permission grants, and user assignments. Admins manage them in **Admin → Members & Permissions**. An access role answers what a user may do in the Kintsugi installation.
- **Project roles** are the RACI vocabulary in `@kintsugi/domain`: the type `ProjectRole`, an open set whose well-known values (`WELL_KNOWN_PROJECT_ROLES`: `pm`, `core-team`, `architect`, `ba`, `dev`, `qc`, `ai-champion`) are the ones the starter rulebook uses. A project may name its own roles in its rulebook. They are used by RACI data, `Performer`/`StagePerformer`, and waiver approvals; they do not grant installation permissions.
- Project-role assignment is future work for **M0 project persistence**. Once project membership is persisted, a project role may be assigned per membership. Until then, the vocabulary describes project responsibilities but there is no persisted project-role assignment mechanism.
- Identity-provider claims authenticate or identify a user; they do not define either Kintsugi access roles or project roles. The “Roles (RACI)” wording in ADR-0008 means **project roles**, not access roles.

Documentation, APIs, and code comments use “access role” for the installation permission bundle and “project role” for the RACI concept. Unqualified “role” is avoided where it could refer to either.

## Consequences

- Access-role administration and authorization behavior remain unchanged; no permission codes or grants, database tables, migrations, routes, or UI behavior change as part of this decision.
- The exported domain symbols `ROLES`/`Role` become `WELL_KNOWN_PROJECT_ROLES`/`ProjectRole`, and `ProjectRole` becomes an open set. Values no rulebook or code used (`admin`, which also collided with the access role, and organisation-specific titles) are dropped from the well-known list; existing rulebook values stay valid. The unused `Raci` type is removed.
- Project-role membership and assignment are not implemented by this ADR. They remain planned work with M0 project persistence.
- ADR-0008 is amended to clarify that its RACI wording refers to project roles and that identity providers do not supply Kintsugi's access roles.

## Alternatives considered

- **Merge both concepts into one role catalog.** Rejected: project responsibility and installation permission are different scopes; combining them risks treating RACI assignment as authorization.
- **Map identity-provider groups to Kintsugi roles now.** Rejected: ADR-0008 keeps Kintsugi's access-role and permission data under Kintsugi administration; external group mapping is not part of this decision.
