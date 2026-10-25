import { Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { JobRunView } from "@/lib/api/job-runs";
import type { ProjectDetail } from "@/lib/api/projects";
import type { Loader } from "@/lib/use-loader";
import { JobRunList } from "./job-run-list";
import { RunListControls } from "./run-list-controls";
import { filterJobRuns } from "./run-model";

export interface ScopedRunsLabels {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  noun: string;
}
interface ScopedRunsPanelProps {
  project: ProjectDetail;
  runs: JobRunView[] | undefined;
  loader: Loader<JobRunView[]>;
  canRun: boolean;
  initialRun: string | undefined;
  labels: ScopedRunsLabels;
  onChanged(): Promise<void>;
  onChooseScope?: () => void;
}
export function ScopedRunsPanel({ project, runs, loader, canRun, initialRun, labels, onChanged, onChooseScope }: ScopedRunsPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const visible = filterJobRuns(runs ?? [], filter, search);
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium text-text">{labels.title}</h2>
          <p className="mt-1 max-w-3xl text-[13px] text-text-secondary">
            Open a run to inspect its progress, console and output. Each run keeps its own scope and attempt history.
          </p>
        </div>
        <Button size="small" className="shadow-border" onClick={() => void loader.reload()}>
          <RefreshCw />
          Refresh
        </Button>
      </header>
      {runs?.length === 0 ? null : (
        <RunListControls
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          searchLabel={`Search ${labels.title.toLowerCase()}`}
          placeholder={`Search run ID, ${labels.noun}, actor or error…`}
        />
      )}
      <Loaded loader={loader} rows={5}>
        {() => (
          <>
            {runs?.length === 0 ? (
              <EmptyState
                icon={Play}
                title={labels.emptyTitle}
                description={labels.emptyDescription}
                action={
                  onChooseScope === undefined ? undefined : (
                    <Button size="small" variant="solid" onClick={onChooseScope}>
                      Choose {labels.noun}s
                    </Button>
                  )
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={Play}
                title="No matching runs"
                description="Try another status or clear the search."
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      setFilter("");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : null}
            <JobRunList
              projectId={project.id}
              runs={visible}
              initialOpen={initialRun}
              canCancel={canRun}
              canRetry={canRun}
              canAbandon={canRun}
              scopeNoun={labels.noun}
              onChanged={() => void onChanged()}
            />
            {runs?.length === 0 ? null : (
              <p className="text-[12px] text-text-secondary">
                {visible.length} of {runs?.length ?? 0} recent runs
              </p>
            )}
          </>
        )}
      </Loaded>
    </section>
  );
}
