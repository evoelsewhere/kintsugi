// Build → Units: one row per designed unit with what the member who built it recorded (the merge request, the cases of their test
// run, the canary) and the state of the runtime's review of that merge request (ADR-0071). For each unit the two ways: build it with
// your own AI client and the CLI, or — once a merge request is recorded — send it to the runtime for review. The merge requests that
// members recorded are listed above, with a button that reviews all their units at once.

import { GitPullRequest, Play, Terminal } from "lucide-react";
import { StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import type { StatusTone } from "@/components/ui/status-dot";
import type { BuildConflict, BuildOverview, BuildTarget, BuildUnit, MergeRequest, ReviewState } from "@/lib/api/build";
import { memberLine, reviewableUnits, reviewBlocker, reviewLine, unitBlocker } from "@/lib/build";
import { MAX_UNITS_PER_RUN } from "@/lib/design-run";
import { formatRelative } from "@/lib/format";

const REVIEW_TONE: Record<ReviewState, StatusTone> = { none: "muted", running: "orange", "in-pr": "purple-light", reviewed: "green" };

function ReviewCell({ unit }: { unit: BuildUnit }): React.JSX.Element {
  const review = unit.review;
  const open = (review.blockers ?? 0) + (review.majors ?? 0);
  const tone: StatusTone = review.state === "reviewed" && (open > 0 || review.stale === true) ? (open > 0 ? "red" : "orange") : REVIEW_TONE[review.state];
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge tone={tone} label={reviewLine(unit)} {...(review.state === "running" ? { busy: "spin" as const } : {})} />
      {review.prUrl === undefined ? null : (
        <a className="text-[11.5px] underline" href={review.prUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          PR
        </a>
      )}
    </span>
  );
}

export function BuildUnitsTab({
  overview,
  target,
  onTarget,
  runDisabled,
  conflicts,
  onReview,
  onCli,
}: {
  overview: BuildOverview;
  target: BuildTarget | undefined;
  onTarget: (repositoryId: string) => void;
  /** Why no review can start (permission, repositories); undefined when one can. */
  runDisabled: string | undefined;
  /** What the API refused in the last request. */
  conflicts: readonly BuildConflict[];
  onReview: (request: MergeRequest, units: string[]) => void;
  onCli: (unit: string) => void;
}): React.JSX.Element {
  const designed = overview.units.filter((unit) => unit.designed);
  if (designed.length === 0) {
    return (
      <Card>
        <EmptyState title="No unit has a merged design yet" description="A unit can be built once at least one of its design documents is merged on the document repository's default branch. Generate and merge its design first." />
      </Card>
    );
  }
  const blocker = runDisabled ?? reviewBlocker(overview, target);
  const requestOf = (unit: BuildUnit): MergeRequest | undefined => overview.mergeRequests.find((entry) => entry.url === unit.member?.mr && entry.commit === unit.member.commit);

  const columns: Column<BuildUnit>[] = [
    {
      id: "unit",
      header: "Unit",
      sort: (row) => row.key,
      search: (row) => `${row.key} ${row.title ?? ""}`,
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-text">{row.key}</span>
          <span className="truncate text-[11.5px] text-text-muted">
            {row.kind} · {row.rules} rule{row.rules === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    {
      id: "member",
      header: "Built by a member",
      title: "What the member's AI client recorded with the member command build: the merge request and the numbers of their test run",
      sort: (row) => row.member?.at,
      search: (row) => `${row.member?.username ?? ""} ${row.member?.mr ?? ""}`,
      cell: (row) =>
        row.member === undefined ? (
          <span className="text-text-muted">—</span>
        ) : (
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
              {row.member.mr === undefined ? (
                "no merge request yet"
              ) : (
                <a className="inline-flex items-center gap-1 underline" href={row.member.mr} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                  <GitPullRequest className="size-3.5" />
                  merge request
                </a>
              )}
              {row.member.commit === undefined ? null : <span className="font-mono text-[11px] text-text-muted">{row.member.commit.slice(0, 8)}</span>}
            </span>
            <span className="truncate text-[11px] text-text-muted">
              {[memberLine(row), row.member.username, formatRelative(row.member.at)].filter((part) => part !== undefined && part !== "").join(" · ")}
            </span>
          </span>
        ),
    },
    { id: "review", header: "Runtime review", sort: (row) => ["none", "running", "in-pr", "reviewed"].indexOf(row.review.state), cell: (row) => <ReviewCell unit={row} /> },
    {
      id: "actions",
      header: "Build it",
      cell: (row) => {
        const blockedBy = unitBlocker(row) ?? blocker;
        const request = requestOf(row);
        return (
          <span className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            <Button size="small" variant="ghost" className="shadow-border" disabled={!row.designed} title="Implement and test it with your own AI client and the CLI" onClick={() => onCli(row.key)}>
              <Terminal className="size-3.5" />
              CLI
            </Button>
            <Button size="small" variant="ghost" className="shadow-border" disabled={blockedBy !== undefined || request === undefined} title={blockedBy ?? "Send the merge request to the runtime for review"} onClick={() => request !== undefined && onReview(request, [row.key])}>
              <Play className="size-3.5" />
              Review
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {overview.mergeRequests.length === 0 ? null : (
        <Card className="px-4 py-3">
          <p className="text-[13px] font-medium text-text">Merge requests members recorded</p>
          <ul className="mt-1.5 flex flex-col">
            {overview.mergeRequests.map((request) => {
              const units = reviewableUnits(request, overview.units).slice(0, MAX_UNITS_PER_RUN);
              const why = units.length === 0 ? "Every unit of it is being reviewed or has a review in a pull request." : blocker;
              return (
                <li key={`${request.url}@${request.commit}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 [box-shadow:0_-1px_0_rgba(0,0,0,0.06)] first:shadow-none">
                  <a className="inline-flex items-center gap-1 text-[12.5px] underline" href={request.url} target="_blank" rel="noreferrer">
                    <GitPullRequest className="size-3.5" />
                    {request.url.replace(/^https?:\/\//, "").slice(0, 60)}
                  </a>
                  <span className="font-mono text-[11px] text-text-muted">{request.commit.slice(0, 8)}</span>
                  <span className="text-[12px] text-text-secondary">
                    {request.units.length} unit{request.units.length === 1 ? "" : "s"}: {request.units.slice(0, 3).join(", ")}
                    {request.units.length > 3 ? ` +${request.units.length - 3}` : ""}
                  </span>
                  {request.reviewed ? <StatusBadge tone="green" label="reviewed at this commit" /> : null}
                  <Button className="ml-auto" size="small" variant="solid" disabled={why !== undefined} title={why} onClick={() => onReview(request, units)}>
                    <Play className="size-3.5" />
                    Review on the portal
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <DataTable
        label="Designed units, the merge requests members recorded and their review"
        rows={designed}
        columns={columns}
        rowKey={(row) => row.key}
        searchPlaceholder="Search units"
        initialSort={{ id: "unit" }}
        minWidth={820}
        pageSize={50}
        toolbar={
          overview.targets.length > 1 ? (
            <Select value={target?.repositoryId ?? ""} onChange={onTarget} options={[{ value: "", label: "Target repository" }, ...overview.targets.map((entry) => ({ value: entry.repositoryId, label: entry.component === undefined ? entry.repositoryId : `${entry.component} (${entry.repositoryId})` }))]} />
          ) : undefined
        }
        empty="No unit matches."
      />
      {blocker === undefined ? null : <p className="text-[12px] text-text-muted">{blocker}</p>}
      {conflicts.length === 0 ? null : (
        <ul className="flex flex-col gap-0.5 text-[12px] text-text-secondary">
          {conflicts.map((conflict) => (
            <li key={conflict.unit}>
              <span className="font-mono">{conflict.unit}</span> {conflict.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
