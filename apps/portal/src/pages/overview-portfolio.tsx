// The modernization portfolio on the Overview, from GET /api/monitoring/portfolio: where each
// application stands in the lifecycle (phase and the gate that closes it), what a person has to
// decide next, how far the unit catalogs are understood and which units are the riskiest still to
// analyse. The outcome of the work, not the state of the jobs: run health stays in Monitoring.

import { CircleAlert, GitPullRequestArrow, ShieldQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { ShareBar } from "@/components/results/charts";
import { ItemStatusBadge } from "@/pages/delivery/results/catalog-view";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { monitoringApi, type PortfolioApplication, type PortfolioDecision, type PortfolioOverview } from "@/lib/api/monitoring";
import { formatRelative } from "@/lib/format";
import { deliveryLink, governanceLink } from "@/lib/links";
import { GATE_STATE, PHASE_LABEL } from "@/lib/phases";
import { ITEM_STATUS, styleOf } from "@/lib/status";
import { useLoader } from "@/lib/use-loader";
import { formatCount } from "./delivery/results/results-format";
import { Section } from "./delivery/results/results-parts";

const ITEM_COLOR: Record<string, string> = {
  understood: CHART_COLOR.green,
  running: CHART_COLOR.blue,
  "in-pr": CHART_COLOR.purple,
  failed: CHART_COLOR.red,
  stale: CHART_COLOR.orange,
  "not-analysed": CHART_COLOR.muted,
};
const ITEM_ORDER = ["understood", "running", "in-pr", "failed", "stale", "not-analysed"] as const;
const COMPLEXITY_TONE: Record<string, StatusTone> = { low: "green", medium: "orange", high: "red" };

const catalogLink = (projectId: string, applicationId: string): string => `${deliveryLink({ projectId, applicationId, stage: "assess" })}&tab=catalog`;

export function Portfolio(): React.JSX.Element {
  const portfolio = useLoader("overview-portfolio", monitoringApi.portfolio, { live: ["job-runs", "document-writes", "repositories", "gates"] });
  return (
    <Loaded loader={portfolio} rows={4}>
      {(data) =>
        data.applications.length === 0 ? null : (
          <div className="flex flex-col gap-4">
            <StatusLines applications={data.applications} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
              <Decisions decisions={data.decisions} className="xl:col-span-3" />
              <UnitFunnel funnel={data.funnel} riskiest={data.riskiest} className="xl:col-span-2" />
            </div>
            <PortfolioTable applications={data.applications} />
          </div>
        )
      }
    </Loaded>
  );
}

/** One sentence per application: phase, what exists, the gate. */
function StatusLines({ applications }: { applications: PortfolioApplication[] }): React.JSX.Element {
  return (
    <section aria-label="Where each application stands" className="flex flex-col gap-2">
      {applications.map((application) => {
        const gate = application.gate === null ? undefined : GATE_STATE[application.gate.status];
        const facts: string[] = [];
        if (application.blocked !== undefined) facts.push(application.blocked);
        else if (application.assess === null) facts.push("not assessed yet");
        else {
          facts.push(`assessed: ${formatCount(application.assess.sloc)} SLOC`);
          if (application.catalog !== null) facts.push(`${application.catalog.understood}/${application.catalog.total} units understood`);
          if (application.assess.critical + application.assess.high > 0) facts.push(`${application.assess.critical} critical, ${application.assess.high} high findings`);
        }
        return (
          <Link
            key={`${application.projectId}/${application.applicationId}`}
            to={deliveryLink({ projectId: application.projectId, applicationId: application.applicationId, stage: "assess" })}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface px-4 py-3 shadow-border-medium hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
          >
            <span className="text-[14px] font-medium text-text">{application.applicationName}</span>
            <span className="rounded-full bg-hover px-2 py-0.5 text-[11.5px] font-medium text-text-secondary">{PHASE_LABEL[application.phase]}</span>
            <span className="text-[13px] text-text-secondary">{facts.join(" · ")}</span>
            {application.gate === null || gate === undefined ? null : (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
                <StatusDot tone={gate.tone} className="size-2" />
                {application.gate.key} {gate.label}
              </span>
            )}
          </Link>
        );
      })}
    </section>
  );
}

const DECISION_ICON = { gate: ShieldQuestion, "pull-request": GitPullRequestArrow, findings: CircleAlert } as const;
const DECISION_LABEL = { gate: "Gate", "pull-request": "Review", findings: "Triage" } as const;

function decisionLink(decision: PortfolioDecision): { to: string; external: boolean } {
  switch (decision.kind) {
    case "gate":
      return { to: governanceLink("gates", "pending"), external: false };
    case "pull-request":
      return decision.prUrl === undefined ? { to: deliveryLink({ projectId: decision.projectId, section: "writes" }), external: false } : { to: decision.prUrl, external: true };
    case "findings":
      return { to: deliveryLink({ projectId: decision.projectId, applicationId: decision.applicationId, stage: "assess" }), external: false };
  }
}

/** What only a person can do next. */
function Decisions({ decisions, className }: { decisions: PortfolioDecision[]; className?: string }): React.JSX.Element {
  return (
    <Section title="Needs your decision" description="Gates waiting for a decision, pull requests to review and findings to triage." className={className}>
      {decisions.length === 0 ? (
        <p className="text-[13px] text-text-secondary">Nothing is waiting for a person.</p>
      ) : (
        <ul className="flex flex-col">
          {decisions.map((decision, index) => {
            const Icon = DECISION_ICON[decision.kind];
            const { to, external } = decisionLink(decision);
            const body = (
              <>
                <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                    <span className="rounded-full bg-hover px-1.5 py-0.5 text-[10.5px] font-medium text-text-secondary">{DECISION_LABEL[decision.kind]}</span>
                    <span className="min-w-0 font-medium">{decision.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-text-muted">
                    {decision.kind === "findings" ? "" : `waiting ${formatRelative(decision.at).replace(/ ago$/, "")} · `}
                    {decision.projectId}
                    {decision.applicationId === undefined ? "" : ` / ${decision.applicationId}`}
                    {decision.detail === undefined ? "" : ` · ${decision.detail}`}
                  </span>
                </span>
              </>
            );
            const style = `flex items-start gap-3 rounded-[var(--geist-radius)] px-2 py-2 hover:bg-hover ${index > 0 ? "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]" : ""}`;
            return (
              <li key={`${decision.kind}-${decision.gateId ?? decision.documentWriteId ?? decision.title}`}>
                {external ? (
                  <a href={to} target="_blank" rel="noreferrer" className={style}>
                    {body}
                  </a>
                ) : (
                  <Link to={to} className={style}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/** How far the catalogs are understood and which units to look at first. */
function UnitFunnel({ funnel, riskiest, className }: { funnel: PortfolioOverview["funnel"]; riskiest: PortfolioOverview["riskiest"]; className?: string }): React.JSX.Element {
  const understood = funnel.counts["understood"] ?? 0;
  return (
    <Section title="Units" description={funnel.total === 0 ? "No catalog yet: assess an application first." : `${understood} of ${funnel.total} units understood.`} className={className}>
      {funnel.total === 0 ? null : (
        <div className="flex flex-col gap-4">
          <ShareBar segments={ITEM_ORDER.map((status) => ({ label: styleOf(ITEM_STATUS, status).label, value: funnel.counts[status] ?? 0, color: ITEM_COLOR[status] ?? CHART_COLOR.muted }))} format={formatCount} />
          {riskiest.length === 0 ? null : (
            <div>
              <p className="mb-1.5 text-[11px] tracking-wide text-text-muted uppercase">Riskiest still to analyse</p>
              <ul className="flex flex-col">
                {riskiest.map((unit) => (
                  <li key={`${unit.applicationId}/${unit.id}`}>
                    <Link to={catalogLink(unit.projectId, unit.applicationId)} className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12.5px] hover:bg-hover">
                      <StatusDot tone={COMPLEXITY_TONE[unit.complexity] ?? "muted"} className="size-2" />
                      <span className="min-w-0 flex-1 truncate font-medium text-text" title={unit.id}>
                        {unit.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted tabular-nums">{formatCount(unit.loc)} lines</span>
                      <ItemStatusBadge status={unit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** Every application with its phase, gate, assessment and understanding. */
function PortfolioTable({ applications }: { applications: PortfolioApplication[] }): React.JSX.Element {
  return (
    <Section title="Portfolio" description="What each application is, what was found and how far the modernization is." actions={<Link to="/delivery" className="shrink-0 text-[12px] text-accent hover:underline">Delivery →</Link>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[13px]" aria-label="Portfolio">
          <thead>
            <tr className="text-left text-[10px] tracking-wide text-text-muted uppercase">
              <th className="px-2 py-2 font-medium">Application</th>
              <th className="px-2 py-2 font-medium">Phase · gate</th>
              <th className="px-2 py-2 text-right font-medium">SLOC</th>
              <th className="px-2 py-2 text-right font-medium">Complexity</th>
              <th className="px-2 py-2 font-medium">Findings</th>
              <th className="w-40 px-2 py-2 font-medium">Understood</th>
              <th className="px-2 py-2 font-medium">Rebuild outlook</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <PortfolioRow key={`${application.projectId}/${application.applicationId}`} application={application} />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** An outlook, kept to one line. */
const gist = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined;
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
};

function PortfolioRow({ application }: { application: PortfolioApplication }): React.JSX.Element {
  const { assess, catalog, gate } = application;
  const to = deliveryLink({ projectId: application.projectId, applicationId: application.applicationId, stage: "assess" });
  const gateState = gate === null ? undefined : GATE_STATE[gate.status];
  const outlook = gist(assess?.outlook);
  return (
    <tr className="align-top [box-shadow:0_-1px_0_var(--color-hover)] hover:bg-hover">
      <td className="px-2 py-2.5">
        <Link to={to} className="font-medium text-text hover:underline">
          {application.applicationName}
        </Link>
        <p className="text-[11px] text-text-muted">
          {application.projectName}
          {application.lastRunAt === undefined ? "" : ` · last run ${formatRelative(application.lastRunAt)}`}
        </p>
      </td>
      <td className="px-2 py-2.5">
        <p className="text-[12.5px] text-text">{PHASE_LABEL[application.phase]}</p>
        {gate === null || gateState === undefined ? null : (
          <p className="inline-flex items-center gap-1.5 text-[11.5px] text-text-secondary">
            <StatusDot tone={gateState.tone} className="size-2" />
            {gate.key} {gateState.label}
          </p>
        )}
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums text-text-secondary">{assess === null ? "—" : formatCount(assess.sloc)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-text-secondary">{assess === null ? "—" : formatCount(assess.complexityIndex)}</td>
      <td className="px-2 py-2.5">
        {assess === null ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-secondary tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={assess.critical > 0 ? "red" : "muted"} className="size-2" />
              {assess.critical} critical
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={assess.high > 0 ? "orange" : "muted"} className="size-2" />
              {assess.high} high
            </span>
            <span className="text-text-muted">{assess.securityFindings} total</span>
          </span>
        )}
      </td>
      <td className="px-2 py-2.5">
        {catalog === null ? (
          <span className="text-text-muted">—</span>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-text-secondary tabular-nums">
              {catalog.understood}/{catalog.total} units
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
              <span className="block h-full rounded-full bg-[var(--ds-status-green)]" style={{ width: `${catalog.total === 0 ? 0 : (catalog.understood / catalog.total) * 100}%` }} />
            </span>
          </div>
        )}
      </td>
      <td className="max-w-[300px] px-2 py-2.5 text-[12px]">
        {outlook === undefined ? <span className="text-text-muted">—</span> : <p className="truncate text-text" title={assess?.outlook}>{outlook}</p>}
      </td>
    </tr>
  );
}
