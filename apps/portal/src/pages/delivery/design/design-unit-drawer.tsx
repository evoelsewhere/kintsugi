// Design → a unit: its design documents set by set, each file with its state, its problems and the
// document itself, and what the rules and the references of the designs come to. A set that is not
// written yet and can be generated has a Generate button (ADR-0049); a written design is corrected in
// its pull request or on its branch, like any document.

import { useMemo, useRef, useState } from "react";
import { Loaded } from "@/components/loaded";
import { DocumentLinksProvider } from "@/components/results/document-links";
import { Markdown } from "@/components/results/lazy-markdown";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { StatusDot } from "@/components/ui/status-dot";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { designApi, type DesignFile, type DesignOverview, type DesignState, type UnitDesign, type UnitSetActivity, type UnitSetDetail } from "@/lib/api/design";
import { applicationEligibility, eligibility } from "@/lib/design-run";
import { APPLICATION_UNIT_KEY, applicationDesignFilePath, unitKeyDesignSetDir } from "@kintsugi/domain";
import { documentsApi } from "@/lib/api/documents";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { splitFrontMatter } from "@/lib/front-matter";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { Field, SubTabs } from "../results/results-parts";
import { ConformanceMark, TemplateRef } from "./design-parts";
import type { RequestGenerate } from "./design-stage";

/** The sub-tab of the drawer: a set id, or "coverage". */
export const COVERAGE_VIEW = "coverage";

const fileState = (file: DesignFile): DesignState => (file.state === "problems" ? "problems" : file.state === "missing" ? "missing" : file.state === "waived" ? "waived" : file.stale ? "stale" : "conformant");

export function UnitDesignDrawer({
  project,
  application,
  unitKey,
  refParam,
  view,
  onView,
  onClose,
  overview,
  activity,
  runDisabled,
  onGenerate,
}: {
  project: ProjectDetail;
  application: ApplicationView;
  unitKey: string | undefined;
  refParam: string | undefined;
  view: string | undefined;
  onView: (view: string) => void;
  onClose: () => void;
  /** The design overview, for what each set of the unit can do now. */
  overview: DesignOverview | undefined;
  activity: readonly UnitSetActivity[];
  /** Why no run can start (permission, repositories); undefined when one can. */
  runDisabled: string | undefined;
  onGenerate: RequestGenerate;
}): React.JSX.Element | null {
  const loader = useLoader(`design/unit/${project.id}/${application.id}/${unitKey ?? ""}/${refParam ?? ""}`, () =>
    unitKey === undefined ? Promise.resolve(undefined) : unitKey === APPLICATION_UNIT_KEY ? designApi.application(project.id, application.id, refParam) : designApi.unit(project.id, application.id, unitKey, refParam),
  );
  if (unitKey === undefined) return null;
  const unit = loader.data;
  return (
    <Drawer
      open
      size="wide"
      title={unitKey === APPLICATION_UNIT_KEY ? "The application" : unitKey}
      subtitle={unit === undefined ? undefined : unitKey === APPLICATION_UNIT_KEY ? `its own design${unit.unit.title === undefined ? "" : ` · ${unit.unit.title}`}` : `${unit.unit.kind}${unit.unit.title === undefined || unit.unit.title === unit.unit.unit ? "" : ` · ${unit.unit.title}`}`}
      onClose={onClose}
    >
      <Loaded loader={loader} rows={8}>
        {(loaded) =>
          loaded === undefined ? null : (
            <DocumentLinksProvider projectId={project.id} commit={loaded.ref.commit}>
              <UnitDesignBody project={project} application={application} unit={loaded} view={view} onView={onView} generate={generateOf(overview, loaded.unit.key, activity, runDisabled, onGenerate)} />
            </DocumentLinksProvider>
          )
        }
      </Loaded>
    </Drawer>
  );
}

/** What the unit's drawer offers for a set: the button that generates it, or why it cannot be generated now. */
type GenerateOf = (set: string) => { action?: () => void; disabled?: string; note?: string } | undefined;

function generateOf(overview: DesignOverview | undefined, unitKey: string, activity: readonly UnitSetActivity[], runDisabled: string | undefined, onGenerate: RequestGenerate): GenerateOf {
  const row = overview?.units.find((unit) => unit.key === unitKey);
  return (setId) => {
    const set = overview?.sets.find((entry) => entry.id === setId);
    if (overview === undefined || set === undefined || (row === undefined && unitKey !== APPLICATION_UNIT_KEY)) return undefined;
    const result = unitKey === APPLICATION_UNIT_KEY ? applicationEligibility(overview, set, activity) : eligibility(row!, set, activity);
    if (result.ok) return runDisabled === undefined ? { action: () => onGenerate(setId, [unitKey]) } : { disabled: runDisabled };
    // A design that is written is not generated again; say why only for the reasons that are about a run.
    return /^(Being generated|In an open pull request|Needs)/.test(result.reason) ? { note: result.reason } : undefined;
  };
}

function UnitDesignBody({ project, application, unit, view, onView, generate }: { project: ProjectDetail; application: ApplicationView; unit: UnitDesign; view: string | undefined; onView: (view: string) => void; generate: GenerateOf }): React.JSX.Element {
  const known = unit.sets.some((set) => set.set === view);
  const current = view === COVERAGE_VIEW ? COVERAGE_VIEW : known ? (view as string) : (unit.sets.find((set) => set.state === "problems" || set.state === "missing")?.set ?? unit.sets[0]?.set ?? COVERAGE_VIEW);
  const uncovered = unit.coverage.filter((row) => row.coveredBy.length === 0).length;
  return (
    <div className="flex flex-col gap-4">
      {unit.sets.length === 0 ? <p className="text-[13px] text-text-secondary">No design set applies to a unit of kind {unit.unit.kind}.</p> : null}
      <SubTabs
        tabs={[
          ...unit.sets.map((set) => ({ id: set.set, label: set.title })),
          { id: COVERAGE_VIEW, label: "Coverage", count: unit.coverage.length === 0 ? undefined : uncovered },
        ]}
        value={current}
        onChange={onView}
      />
      {current === COVERAGE_VIEW ? (
        <CoverageView unit={unit} />
      ) : (
        (() => {
          const set = unit.sets.find((entry) => entry.set === current);
          return set === undefined ? null : <SetView key={set.set} project={project} application={application} unit={unit} set={set} generate={generate(set.set)} />;
        })()
      )}
    </div>
  );
}

function SetView({ project, application, unit, set, generate }: { project: ProjectDetail; application: ApplicationView; unit: UnitDesign; set: UnitSetDetail; generate: ReturnType<GenerateOf> }): React.JSX.Element {
  const first = set.files.find((file) => file.state === "problems") ?? set.files.find((file) => file.state === "missing" && file.required) ?? set.files[0];
  const [chosen, setChosen] = useState<string | undefined>(first?.path);
  const file = set.files.find((entry) => entry.path === chosen) ?? first;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-secondary">
        <ConformanceMark state={set.state} />
        <span className="font-mono text-[11.5px]">
          {set.set}@{set.version}
        </span>
        {set.needs.length === 0 ? null : <span>after {set.needs.join(", ")}</span>}
        <GenerateAction generate={generate} set={set.set} />
      </div>
      <ul className="flex flex-col gap-1" aria-label="Files of the set">
        {set.files.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              aria-pressed={entry.path === file?.path}
              onClick={() => setChosen(entry.path)}
              className={cn("flex w-full items-center gap-3 rounded-[var(--geist-radius)] px-2.5 py-1.5 text-left text-[13px] hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]", entry.path === file?.path && "bg-hover")}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{entry.path}</span>
              {entry.required ? null : <span className="text-[11px] text-text-muted">optional</span>}
              {entry.state === "problems" ? <span className="text-[11.5px] text-text-muted tabular-nums">{entry.problems.length}</span> : null}
              <ConformanceMark state={fileState(entry)} label={entry.state === "problems" ? "Problems" : entry.state === "missing" && !entry.required ? "Not written" : undefined} />
            </button>
          </li>
        ))}
      </ul>
      {file === undefined ? null : <FileView project={project} application={application} unit={unit} set={set} file={file} />}
    </div>
  );
}

/** The Generate button of a set, or the reason it is not offered (a run is on it, or a set it needs is missing). */
function GenerateAction({ generate, set }: { generate: ReturnType<GenerateOf>; set: string }): React.JSX.Element | null {
  if (generate === undefined) return null;
  if (generate.note !== undefined) return <span className="text-[12px] text-text-muted">{generate.note}</span>;
  return (
    <Button size="small" variant="ghost" className="shadow-border" disabled={generate.action === undefined} title={generate.disabled} onClick={generate.action}>
      <Play className="size-3.5" />
      Generate {set}
    </Button>
  );
}

function FileView({ project, application, unit, set, file }: { project: ProjectDetail; application: ApplicationView; unit: UnitDesign; set: UnitSetDetail; file: DesignFile }): React.JSX.Element {
  const path = unit.unit.key === APPLICATION_UNIT_KEY ? applicationDesignFilePath(application.id, set.set, file.path) : `${unitKeyDesignSetDir(application.id, unit.unit.key, set.set)}/${file.path}`;
  return (
    <div className="flex flex-col gap-3">
      {file.stale ? (
        <p className="rounded-[var(--geist-radius)] bg-hover px-3 py-2 text-[12.5px] text-text-secondary">
          <StatusDot tone="orange" className="mr-1.5 size-2" />
          Written against <TemplateRef value={file.template} expected={file.expected} />. Bring it up to date with the changes of the template, or leave it: its version moved after this design was written.
        </p>
      ) : null}
      {file.state === "waived" ? (
        <p className="rounded-[var(--geist-radius)] bg-hover px-3 py-2 text-[12.5px] text-text-secondary">
          <span className="font-medium text-text">Waived:</span> {file.waiver}
        </p>
      ) : null}
      {file.state === "missing" ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
          <span>{file.required ? "This file is required and not written yet." : "This optional file is not written."}</span>
        </div>
      ) : null}
      {file.problems.length === 0 ? null : <ProblemList problems={file.problems} />}
      {file.state === "missing" || file.state === "waived" ? null : <DocumentView project={project} commit={unit.ref.commit} path={path} problems={file.problems} />}
    </div>
  );
}

function ProblemList({ problems, onGo }: { problems: DesignFile["problems"]; onGo?: (section: string) => void }): React.JSX.Element {
  return (
    <section aria-label="Problems" className="flex flex-col gap-1">
      <h4 className="text-[11px] font-medium tracking-wide text-text-muted uppercase">Problems ({problems.length})</h4>
      <ul className="flex flex-col gap-1">
        {problems.map((problem, index) => (
          <li key={index} className="flex items-start gap-2 text-[13px] text-text-secondary">
            <StatusDot tone="red" className="mt-1.5 size-2 shrink-0" />
            <span className="min-w-0 flex-1">
              {problem.section === undefined ? null : <span className="font-medium text-text">{problem.section}: </span>}
              {problem.message}
            </span>
            {onGo === undefined || problem.section === undefined ? null : (
              <button type="button" onClick={() => onGo(problem.section as string)} className="shrink-0 text-[12px] text-accent hover:underline">
                Go to section
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The design document as the template's author wrote it, with its front matter as a small list. */
function DocumentView({ project, commit, path, problems }: { project: ProjectDetail; commit: string; path: string; problems: DesignFile["problems"] }): React.JSX.Element {
  const file = useLoader(`design/doc/${project.id}/${commit}/${path}`, () => documentsApi.file(project.id, path, commit));
  const container = useRef<HTMLDivElement>(null);
  const go = (section: string): void => {
    const heading = [...(container.current?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? [])].find((node) => node.textContent?.trim().toLowerCase() === section.trim().toLowerCase());
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sectioned = useMemo(() => problems.some((problem) => problem.section !== undefined), [problems]);
  return (
    <div className="flex flex-col gap-3">
      {sectioned ? <ProblemJumps problems={problems} onGo={go} /> : null}
      <Loaded loader={file} rows={8}>
        {(loaded) => {
          const { fields, body } = splitFrontMatter(loaded.content);
          return (
            <div ref={container} className="flex flex-col gap-3">
              {fields.length === 0 ? null : (
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-recessed p-3 text-[12px]">
                  {fields.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-text-muted">{key}</dt>
                      <dd className="min-w-0 break-words text-text-secondary">{value === "" ? "—" : value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Markdown text={body} path={path} />
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

/** A row of jumps to the sections that have problems. */
function ProblemJumps({ problems, onGo }: { problems: DesignFile["problems"]; onGo: (section: string) => void }): React.JSX.Element {
  const sections = [...new Set(problems.flatMap((problem) => (problem.section === undefined ? [] : [problem.section])))];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
      Jump to
      {sections.map((section) => (
        <button key={section} type="button" onClick={() => onGo(section)} className="rounded-[var(--geist-pill-radius)] px-2 py-0.5 text-text-secondary shadow-border hover:bg-hover hover:text-text">
          {section}
        </button>
      ))}
    </div>
  );
}

function CoverageView({ unit }: { unit: UnitDesign }): React.JSX.Element {
  const columns: Column<UnitDesign["coverage"][number]>[] = [
    { id: "rule", header: "Rule", sort: (row) => row.rule, cell: (row) => <span className="font-mono text-[12px] text-text">{row.rule}</span> },
    { id: "title", header: "Title", search: (row) => row.title, cell: (row) => <span className="text-text-secondary">{row.title === "" ? "—" : row.title}</span> },
    {
      id: "covered",
      header: "Covered by",
      cell: (row) =>
        row.coveredBy.length === 0 ? (
          <span className="text-text-muted">no written design names it</span>
        ) : (
          <span className="flex flex-col text-[12px] text-text-secondary">
            {row.coveredBy.map((entry) => (
              <span key={`${entry.set}/${entry.file}/${entry.section}`}>
                {entry.set}/{entry.file} · {entry.section}
              </span>
            ))}
          </span>
        ),
    },
    { id: "state", header: "State", sort: (row) => (row.coveredBy.length === 0 ? 0 : 1), cell: (row) => <ConformanceMark state={row.coveredBy.length === 0 ? "missing" : "conformant"} label={row.coveredBy.length === 0 ? "Not covered" : "Covered"} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      {unit.coverage.length === 0 ? (
        <p className="text-[13px] text-text-secondary">The unit has no rules in its understanding, or no design lists rules yet.</p>
      ) : (
        <DataTable label="Rules and the designs that cover them" rows={unit.coverage} columns={columns} rowKey={(row) => row.rule} initialSort={{ id: "state" }} pageSize={20} minWidth={520} searchPlaceholder="Search rules" />
      )}
      <Field label="References that do not resolve">
        {unit.unresolved.length === 0
          ? undefined
          : unit.unresolved.map((entry) => (
              <p key={`${entry.id}/${entry.file}/${entry.section}`} className="text-[13px]">
                <span className="font-mono text-[12px] text-text">{entry.id}</span> in {entry.set}/{entry.file} · {entry.section}, not among the {entry.source === "basic" || entry.source === "components" || entry.source === "rules" || entry.source === "requirements" ? entry.source : `design items of ${entry.source}`}
              </p>
            ))}
      </Field>
      {unit.unresolved.length === 0 ? <p className="text-[12px] text-text-muted">Every reference of the written designs resolves.</p> : null}
    </div>
  );
}
