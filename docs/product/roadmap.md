# Roadmap

**Strategy:**
- Build the **runtime (pi) + knowledge** first, because that is what Kintsugi uniquely owns. Then connect it to the harnesses members already use.
- The vertical slice used for validation is a version-upgrade migration, e.g. .NET Core 3.1 → .NET 8 and React 17 → 19.

| Milestone | Goal | Main scope | Validation |
|---|---|---|---|
| **M0 Foundation** | A working package | Docker Compose (app, worker, postgres+pgvector); username/password sign-in + PAT; projects / applications; multiple Git servers and repos; Git sync (clone / fetch / poll); project create / join from the document repo starter template; `kintsugi.yaml` validation (document, legacy, legacy-data and target repos); LLM provider registry (pi providers + custom, test connection); runtime jobs in job workspaces (ADR-0029), `JobEvent` → SSE; pg-boss jobs; worker commit / PR of results | `docker compose up` on a clean host → run one runtime agent on a sample repo → the result appears as a PR in the document repo, with live events and cost |
| **M1 Knowledge + Assess** | First runtime value | `knowledge-ingest` (source code, xlsx/docx → md), AS-IS KB, `kb-assistant` in the portal; inventory, `assessment` (scorecard + 7R), `wave-planner` | Assess a sample portfolio of ≥ 10 apps; KB answers with citations; assessment verified on a real stack pair |
| **M2 Member access** | Connect members | Read-only CLI and local stdio MCP over the scoped HTTPS API; cited task/design/standards context; separate hookless access plugin; Claude Code pilot with per-client proof for Codex and Copilot CLI | A developer asks their chosen AI about one assigned task, retrieves complete context, works locally and opens a normal PR |
| **M3 PR continuation** | Close the workflow loop | GitHub PR reconciliation, fixed-revision review and findings, authorized human gate evidence, durable continuation and SSE; later provider/client adapters | A PR opened while the developer is offline is reviewed and the next workflow step starts only after exact merged evidence is approved |
| **M4 Governance** | Enterprise-ready | Policy-as-code, gates G0–G6, ARB workflow, audit + traceability matrix, asset lifecycle (eval → approve → publish), Entra ID sign-in | Complete audit trail for one pilot project |
| **M5 Verify → Hypercare** | Cover the end of the pipeline | Compare harness (golden cases, deterministic diff, triage, human sign-off); test-case plugins; rehearsal, cutover checklist, user manual / chatbot, Datadog / New Relic integration | One project runs P0–P7 end to end on Kintsugi |

## Prerequisites

- **Open decisions**: see the [decision register](../decisions/README.md#next-decisions).
- **Seed content**: build an inventory of existing assets that projects can copy into their `standards/` and `plugins/`, e.g. as an organization library:
  - prompt libraries (version upgrade, unit-test generation, test-case generation, detail-design generation);
  - document converters (Excel → Markdown);
  - AI code-review tooling (IDE extension, CI action).

## Accepted follow-ups

- **Portal Settings UI refactor**: the Settings modal + Providers section work but need a visual pass — tighten spacing rhythm (modal, sections, cards), provider brand icons, macOS-style collapsible sidebar. Tracked from implementation feedback; land as part of M0 portal work.
