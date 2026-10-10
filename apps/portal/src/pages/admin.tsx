import { Breadcrumbs } from "../components/breadcrumbs";
import { AreaCard, type AreaCardProps } from "../components/area-card";

/** Functional areas A1–A7 (docs/architecture/05-building-block-view.md). */
const AREAS = [
  {
    title: "A1 · Projects & Applications",
    description: "Programs, projects, applications, code repos, document repo. One installation = one organization.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A2 · Identity & Access",
    description: "Username/password sign-in, PATs for CLI/MCP, users, RACI roles, project-scoped RBAC.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A3 · Connectors",
    description: "Git servers, Jira / Confluence / SharePoint, source databases (read-only), observability tools.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A4 · LLM Providers & Harness Registry",
    description: "Provider registry, credentials, model binding per runtime agent, budget; harness plugin support and fallback renderers.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A5 · Templates",
    description: "SDLC / pipeline templates per 7R, deliverable and RACI templates, the document repo starter template.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A6 · Project Build",
    description: "Repository setup per application (AS-IS legacy and legacy-data repos, TO-BE target repos per component), standards/ and plugins/ in the document repo.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "A7 · Extension Allowlists",
    description: "Runner image allowlist and harness transformer plugins.",
    status: "not implemented yet",
    tone: "muted",
  },
] as const satisfies ReadonlyArray<AreaCardProps>;

export function AdminPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Admin"]} />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((area) => (
          <AreaCard key={area.title} {...area} />
        ))}
      </section>
    </div>
  );
}
