# Roadmap

**Strategy:**
- Build the **runtime (pi) + knowledge** first, because that is what Kintsugi uniquely owns. Then connect it to the harnesses members already use.
- The vertical slice used for validation is a version-upgrade migration, e.g. .NET Core 3.1 → .NET 8 and React 17 → 19.

| Milestone | Goal | Main scope | Validation |
|---|---|---|---|
| **M0 Foundation** | A working package | Docker Compose (app, worker, runner, postgres+pgvector, egress-proxy); username/password sign-in + PAT; projects / applications; multiple Git servers and repos; Git sync (clone / fetch / poll); project create / join from the document repo starter template; `kintsugi.yaml` validation (document, legacy, legacy-data and target repos); LLM provider registry (pi providers + custom, test connection); pi runner in a container, `JobEvent` → SSE; pg-boss jobs; worker commit / PR of results | `docker compose up` on a clean host → run one runtime agent on a sample repo → the result appears as a PR in the document repo, with live events and cost |
| **M1 Knowledge + Assess** | First runtime value | `knowledge-ingest` (source code, xlsx/docx → md), AS-IS KB, `kb-assistant` in the portal; inventory, `assessment` (scorecard + 7R), `wave-planner` | Assess a sample portfolio of ≥ 10 apps; KB answers with citations; assessment verified on a real stack pair |
| **M2 Harness Hub** | Connect members | Kintsugi MCP server (`kb.*`, `task.*`, `artifact.register`; PAT auth), `kintsugi` CLI, asset renderer for the priority harness (Copilot or Claude Code), `task-planner` + task packs (standards, skills) | Members migrate 1–2 features of the sample app in their own harness, taking context only from Kintsugi |
| **M3 Gate & Metrics** | Close the loop | PR detection (polling / webhooks), `gate-reviewer` on PRs, gate G4, `HarnessActivity` from MCP/CLI + Git trailers + OTel; AI metrics (coverage, outcome ratio, defect rate); renderers for the remaining harnesses | Compare against a manually executed baseline; ≥ 3 harnesses produce comparable metrics; one project's standards used end to end |
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
