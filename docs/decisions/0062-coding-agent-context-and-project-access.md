# ADR-0062: Scope Coding Agent Workflow context with Project Access and immutable snapshots

- Status: Partly superseded by [ADR-0067](0067-remove-access-and-review-plugins.md): explicit Project Access stays, task context and snapshots are gone
- Date: 2026-10-20
- Decision register: D76
- Amends: [ADR-0012](0012-work-items-as-files-in-git.md), [ADR-0024](0024-access-roles-vs-project-roles.md), [ADR-0038](0038-document-repo-layout-by-subject-and-sdlc-phase.md), [ADR-0051](0051-document-repo-layout-legacy-and-modern.md)

## Context

The document repository is the source of truth for unit state, tasks, designs, standards and gate records. The Coding Agent Context API must not create a second authoritative task store or allow an assignment, display name, snapshot handle or document string to grant access. Follow-up questions also need to use the same revisions as the task brief; silently switching to a newer default branch can mix incompatible requirements.

## Decision

1. Authorization starts with an authenticated installation user and current Project Access grant. Member tokens are scoped to named projects and read operations. Access roles and project RACI responsibilities remain separate; assignment is not an access grant. Every request, including requests using a prior snapshot, checks current authorization.
2. The unit's full identity is project, application, module and unit. The validated unit-state file and task document in the document repository remain authoritative; Postgres holds only rebuildable indexes and bounded operational snapshot metadata.
3. Context sources are selected from the unit, its explicit references and shared document-layout helpers. The application-level TO-BE design is a basic-design candidate; the unit-level design is a detailed-design candidate. Standards and evidence are included only when the task or policy identifies them.
4. Readiness is a deterministic projection for a requested activity. Design work may begin when its predecessors permit even if the detailed design is the output being produced. Implementation requires the applicable approved predecessor gates and required designs and standards at their referenced revisions. The task's acceptance gate is an exit condition and cannot block producing its own evidence.
5. Availability and approval are distinct. Missing, draft, pending, rejected, unknown and approved sources are reported separately. A pending gate scaffold, an auto-committed task, default-branch presence, ancestry, or an approval word in arbitrary Markdown is not proof of approval.
6. A task brief creates an explicit immutable snapshot handle. The manifest binds each repository to its full Git commit, source path and content hash, task and deliverable revisions, source role, validated approval evidence and policy version. Repositories retain separate commit identities. Retrieval, search and pagination require the handle and return exact citations. A handle identifies a snapshot but grants no authority.
7. Bounded responses preserve an index of mandatory sections. If required content is omitted or too large, the result is partial and names the exact source and section to fetch. No request substitutes the current branch head when a pinned object is unavailable. Expired, revoked and unavailable snapshots return stable errors and a repair path.
8. Stable member identity is used for task assignment filters. Ambiguous display names do not match an assignee. Reading or selecting a task has no assignment side effect.
9. Required deliverables are declared in unit-state frontmatter as a bounded list of stable IDs, repository IDs and relative paths. Briefs carry those declared IDs into their context manifest. Prose and PR links are not parsed into authoritative declarations; existing units without declarations remain readable while implementation approval stays fail-closed.

## Consequences

- A task brief can be reproduced after the branch advances and after an API restart, as long as its pinned Git objects are retained.
- Readiness, source approval and context completeness are visible to the agent and developer with reasons and citations.
- Required design content larger than the brief budget must be fetched through explicit section calls before implementation is considered complete.
- Implementations must reuse shared project roles, phases, unit identities and document path helpers rather than creating parallel vocabulary.
- Existing task and gate Markdown stays readable; evidence validation will be added as a versioned contract.

## Alternatives considered

- **Resolve every follow-up from the current branch head.** Rejected because a later question could silently change the requirements the agent was given.
- **Treat unit assignment as permission.** Rejected because project responsibility and authorization have different scope.
- **Infer approval from a field or merged ancestry alone.** Rejected because the approving actor and exact reviewed evidence must be verified.
