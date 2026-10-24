// Design → Sets: the project's own templates, as it defined them in 01-standards/templates/. A table of
// the sets and, for one, its files, the contract of every template section, the sets it needs
// and the faults of its definition. The portal does not edit a template: it changes by a pull
// request to the document repo.

import { AlertTriangle } from "lucide-react";
import { lazy, Suspense } from "react";
import { designSetDir } from "@kintsugi/domain";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { DetailPage } from "@/components/detail-page";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { DesignProfile, DesignSet, DesignSetFile, DesignSetsView } from "@/lib/api/design";
import { Field, Section } from "../results/results-parts";
import { CopyButton } from "./design-parts";
import { setLabel } from "./design-state";

const MermaidDiagram = lazy(() => import("@/components/results/mermaid-diagram").then((module) => ({ default: module.MermaidDiagram })));

/** The `needs` of the sets as a flowchart, an arrow from a set to the one that needs it. */
function needsDiagram(sets: DesignSet[]): string {
  const id = (value: string): string => `s_${value.replace(/[^A-Za-z0-9]/g, "_")}`;
  const lines = ["flowchart LR", ...sets.map((set) => `  ${id(set.id)}["${set.title.replace(/"/g, "'")} (${setLabel(set)})"]`)];
  for (const set of sets) for (const need of set.needs) lines.push(`  ${id(need)} --> ${id(set.id)}`);
  return lines.join("\n");
}

export function DesignSetsTab({
  view,
  chosen,
  onChoose,
  showUsage,
}: {
  view: DesignSetsView;
  chosen: string | undefined;
  onChoose: (set: string | undefined) => void;
  showUsage: boolean;
}): React.JSX.Element {
  const { sets, problems } = view;
  if (sets.length === 0 && problems.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No design sets yet"
          description="Define the project's design sets in 01-standards/templates/ of the document repo, one folder per set with a set.md and a template per document. The starter template has a basic, a detail, an API and a test design to copy and change."
          action={<span className="text-[12px] text-text-muted">Guide: docs/guides/define-design-templates.md</span>}
        />
      </Card>
    );
  }
  const columns: Column<DesignSet>[] = [
    { id: "set", header: "Set", sort: (set) => set.id, search: (set) => `${set.id} ${set.title}`, cell: (set) => <span className="flex flex-col"><span className="text-text">{set.title}</span><span className="font-mono text-[11.5px] text-text-muted">{set.id}</span></span> },
    { id: "version", header: "Ver", align: "right", sort: (set) => set.version, cell: (set) => <span className="text-text-secondary">{set.version}</span> },
    { id: "applies", header: "Applies to", search: (set) => `${set.scope} ${set.appliesTo.join(" ")}`, cell: (set) => <span className="text-text-secondary">{set.scope === "application" ? "the application" : set.appliesTo.length === 0 ? "every kind" : set.appliesTo.join(", ")}</span> },
    { id: "needs", header: "Needs", search: (set) => set.needs.join(" "), cell: (set) => <span className="text-text-secondary">{set.needs.length === 0 ? "—" : set.needs.join(", ")}</span> },
    {
      id: "stage",
      header: "Produced by",
      cell: (set) =>
        set.producedBy.length > 0 ? (
          <span className="text-text-secondary">{set.producedBy.map((entry) => `${entry.stage} (${entry.pipeline})`).join(", ")}</span>
        ) : (
          <span className="text-text-muted">{set.stage === undefined ? "—" : `${set.stage} (not in a pipeline)`}</span>
        ),
    },
    { id: "files", header: "Files", align: "right", sort: (set) => set.files.length, cell: (set) => <span className="text-text-secondary">{set.files.length}</span> },
    { id: "profiles", header: "Profiles", search: (set) => set.profiles.map((profile) => profile.kind).join(" "), cell: (set) => <span className="text-text-secondary">{set.profiles.length === 0 ? "—" : set.profiles.map((profile) => profile.kind).join(", ")}</span> },
    ...(showUsage
      ? [
          {
            id: "usage",
            header: "Units on the current version",
            cell: (set: DesignSet) => (set.usage === undefined ? "—" : <span className="text-text-secondary tabular-nums">{set.usage.onCurrent}/{set.usage.units}{set.usage.stale > 0 ? <span className="ml-2 text-[var(--ds-status-orange)]">{set.usage.stale} stale</span> : null}</span>),
          } satisfies Column<DesignSet>,
        ]
      : []),
  ];
  const selected = sets.find((set) => set.id === chosen);
  return (
    <div className="flex flex-col gap-4">
      {problems.length === 0 ? null : (
        <Card className="px-4 py-3" role="alert">
          <p className="flex items-center gap-2 text-[13px] font-medium text-text">
            <AlertTriangle className="size-4 text-[var(--ds-status-orange)]" strokeWidth={1.75} />
            {problems.length} problem{problems.length === 1 ? "" : "s"} in the design templates
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-text-secondary">
            {problems.map((problem, index) => (
              <li key={index}>
                <span className="font-mono text-[11.5px] text-text">{problem.path}</span>: {problem.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-text-muted">Sets with faults are still listed when they can be read; a pull request that fixes them is checked with validate_design_templates.py.</p>
        </Card>
      )}
      {sets.length === 0 ? null : <DataTable label="Design sets" rows={sets} columns={columns} rowKey={(set) => set.id} onRowClick={(set) => onChoose(set.id)} selectedKey={chosen} pageSize={0} minWidth={640} />}
      <DetailPage open={selected !== undefined} title={selected?.title ?? ""} subtitle={selected === undefined ? undefined : <span className="font-mono">{setLabel(selected)}</span>} onClose={() => onChoose(undefined)}>
        {selected === undefined ? null : <SetDetail set={selected} sets={sets} problems={problems} onChoose={onChoose} />}
      </DetailPage>
    </div>
  );
}

function SetDetail({ set, sets, problems, onChoose }: { set: DesignSet; sets: DesignSet[]; problems: DesignSetsView["problems"]; onChoose: (set: string | undefined) => void }): React.JSX.Element {
  const here = problems.filter((problem) => problem.path.startsWith(`${designSetDir(set.id)}/`));
  const related = sets.filter((entry) => entry.id === set.id || set.needs.includes(entry.id) || entry.needs.includes(set.id));
  const folder = `${designSetDir(set.id)}/`;
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-recessed p-3 text-[12px]">
        {(
          [
            ["id", set.id],
            ["version", String(set.version)],
            ["scope", set.scope === "application" ? "application (one design for the whole application)" : "unit (a design per unit)"],
            ["appliesTo", set.scope === "application" ? "—" : set.appliesTo.length === 0 ? "every kind" : set.appliesTo.join(", ")],
            ["reads", set.reads.length === 0 ? "—" : set.reads.join(", ")],
            ["needs", set.needs.length === 0 ? "—" : set.needs.join(", ")],
            ["stage", set.stage ?? "—"],
            ["produced by", set.producedBy.length === 0 ? "no pipeline names it" : set.producedBy.map((entry) => `${entry.stage} in ${entry.pipeline}`).join(", ")],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-text-muted">{key}</dt>
            <dd className="min-w-0 break-words text-text-secondary">{value}</dd>
          </div>
        ))}
      </dl>
      {set.description === "" ? null : <p className="text-[13px] leading-6 text-text-secondary">{set.description}</p>}
      {set.instructions === "" ? null : (
        <Field label="Instructions to the designer">
          <p className="whitespace-pre-line text-[13px] leading-6">{set.instructions}</p>
        </Field>
      )}
      {here.length === 0 ? null : (
        <Field label="Faults of this set">
          {here.map((problem, index) => (
            <p key={index} className="text-[13px]">
              <span className="font-mono text-[11.5px] text-text">{problem.path.replace(folder, "")}</span>: {problem.message}
            </p>
          ))}
        </Field>
      )}
      {related.length > 1 ? (
        <Section title="Order of work" description="An arrow goes from a set to the one that needs it; click a set to open it.">
          <Suspense fallback={<SkeletonRows rows={3} />}>
            <MermaidDiagram
              title="Design sets and what each needs"
              source={needsDiagram(related)}
              height={220}
              onNodeClick={(node) => {
                const target = related.find((entry) => `s_${entry.id.replace(/[^A-Za-z0-9]/g, "_")}` === node);
                if (target !== undefined) onChoose(target.id);
              }}
            />
          </Suspense>
        </Section>
      ) : null}
      {set.files.length === 0 ? null : (
        <Section title={set.profiles.length === 0 ? "Documents" : "Documents of every kind"} description="What each unit kind has unless its profile changes it.">
          {set.files.map((file) => (
            <FileContract key={file.path} file={file} />
          ))}
        </Section>
      )}
      {set.profiles.map((profile) => (
        <ProfileDetail key={profile.kind} profile={profile} set={set} />
      ))}
      <Field label="Changing this template">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>
            A pull request to <span className="font-mono text-[12px]">{folder}</span> in the document repo; raise <span className="font-mono text-[12px]">version</span> in set.md when it affects designs already written.
          </span>
          <CopyButton text={folder} label="Copy path" what="Path" />
        </div>
      </Field>
    </div>
  );
}

/** One unit kind's variation of a set (ADR-0053): the documents it has, its instructions, and the contract of the templates it replaces. */
function ProfileDetail({ profile, set }: { profile: DesignProfile; set: DesignSet }): React.JSX.Element {
  const own = profile.files.filter((file) => file.profile !== undefined);
  return (
    <Section title={`Units of kind ${profile.kind}`} description={`Profile version ${profile.version} · ${designSetDir(set.id)}/${profile.kind}/profile.md`}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-secondary">
          Documents: {profile.files.length === 0 ? "none" : profile.files.map((file) => `${file.path} (${file.ref})`).join(", ")}
          {profile.removes.length === 0 ? "" : ` · without ${profile.removes.join(", ")}`}
        </p>
        {profile.instructions === "" ? null : (
          <Field label="Instructions to the designer for this kind">
            <p className="whitespace-pre-line text-[13px] leading-6">{profile.instructions}</p>
          </Field>
        )}
        {own.map((file) => (
          <FileContract key={file.path} file={file} />
        ))}
      </div>
    </Section>
  );
}

function FileContract({ file }: { file: DesignSetFile }): React.JSX.Element {
  const columns: Column<DesignSetFile["sections"][number]>[] = [
    { id: "heading", header: "Section", sort: (section) => section.heading, cell: (section) => <span className="text-text">{section.heading}</span> },
    { id: "required", header: "Required", cell: (section) => <span className="text-text-secondary">{section.required ? "yes" : "no"}</span> },
    { id: "table", header: "Table columns", cell: (section) => <span className="text-text-secondary">{section.table === undefined ? "—" : section.table.join(" | ")}</span> },
    { id: "checks", header: "Checks", cell: (section) => (section.checks.length === 0 ? <span className="text-text-muted">—</span> : <span className="flex flex-col font-mono text-[11.5px] text-text-secondary">{section.checks.map((check) => <span key={check}>{check}</span>)}</span>) },
    { id: "guidance", header: "Guidance", cell: (section) => <span className="text-[12px] text-text-secondary">{section.guidance ?? "—"}</span> },
  ];
  return (
    <Section
      title={file.path}
      description={`${file.required ? "Required" : "Optional"} · template ${file.profile === undefined ? file.template : `${file.profile}/${file.template}`} (${file.ref})${file.example === undefined ? "" : ` · example ${file.example}`}`}
    >
      {file.sections.length === 0 ? (
        <p className="text-[13px] text-text-secondary">The template has no section with a contract: its headings are structure only.</p>
      ) : (
        <DataTable label={`Sections of ${file.path}`} rows={file.sections} columns={columns} rowKey={(section) => section.heading} pageSize={0} minWidth={640} />
      )}
    </Section>
  );
}
