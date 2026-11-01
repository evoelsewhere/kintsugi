# Roadmap

**Strategy:**
- Build the **runtime (pi) + knowledge** first, because that is what Kintsugi uniquely owns. Then connect it to the harnesses members already use.
- The vertical slice used for validation is a version-upgrade migration, e.g. .NET Core 3.1 → .NET 8 and React 17 → 19.

| Milestone | Goal | Main scope | Validation |
|---|---|---|---|
| **M0 Foundation** | A working package | Docker Compose (app, worker, postgres+pgvector); username/password sign-in + PAT; projects / applications; multiple Git servers and repos; Git sync (clone / fetch / poll); project create / join from the document repo starter template; `kintsugi.yaml` validation (document, legacy, legacy-data and target repos); LLM provider registry (pi providers + custom, test connection); runtime jobs in job workspaces (ADR-0029), `JobEvent` → SSE; pg-boss jobs; worker commit / PR of results | `docker compose up` on a clean host → run one runtime agent on a sample repo → the result appears as a PR in the document repo, with live events and cost |
| **M1 Knowledge + Assess** | First runtime value | `knowledge-ingest` (source code, xlsx/docx → md; planned, not shipped), AS-IS KB (reached as the Brain, a tree index without vectors, [ADR-0091](../decisions/0091-brain-vectorless-tree-index.md)), `kb-assistant` in the portal (planned, not shipped); inventory, `assessment` (scorecard), `wave-planner` (planned, not shipped) | Assess a sample portfolio of ≥ 10 apps; KB answers with citations; assessment verified on a real stack pair |
| **M2 Common member base** | Connect members | The CLI and local stdio MCP over the scoped HTTPS member API (projects, documents), Project Access, browser authorization, the generated connector plugin ([ADR-0069](../decisions/0069-common-member-base-and-plugin-distribution.md)); member flows come as plugins, distributed, permitted and monitored by Kintsugi | A member connects their chosen AI client and reads their project's documents; later plugins add flows |
| **M3 PR continuation** | Close the workflow loop | Replaced: the task, review and gate workflow it continued was removed ([ADR-0067](../decisions/0067-remove-access-and-review-plugins.md)). A member now builds and tests a designed unit with `/modernize:build`, which records the merge request, and the runtime reviews it ([ADR-0071](../decisions/0071-members-build-runtime-reviews.md), [ADR-0072](../decisions/0072-init-install-and-plugins-as-plugins.md)) | A member's merge request is reviewed by the runtime and the findings arrive as a document pull request |
| **M4 Governance** | Enterprise-ready | Policy-as-code, gates G0–G4, ARB workflow, audit + traceability matrix, asset lifecycle (eval → approve → publish), Entra ID sign-in | Complete audit trail for one pilot project |

## Prerequisites

- **Open decisions**: see the [decision register](../decisions/README.md#next-decisions).
- **Seed content**: build an inventory of existing assets that projects can copy into their `01-standards/` and `plugins/`, e.g. as an organization library:
  - prompt libraries (version upgrade, unit-test generation, test-case generation, detail-design generation);
  - document converters (Excel → Markdown);
  - AI code-review tooling (IDE extension, CI action).

## Accepted follow-ups

- **Portal Settings UI refactor**: the Settings modal + Providers section work but need a visual pass — tighten spacing rhythm (modal, sections, cards), provider brand icons, macOS-style collapsible sidebar. Tracked from implementation feedback; land as part of M0 portal work.
