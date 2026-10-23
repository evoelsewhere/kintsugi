// The overview of the understand stage while no item has been understood yet: the way from the empty
// views to filled ones runs through the Catalog (pick items, run understand, merge the pull request),
// so that is what it says and the one action is to open the Catalog.

import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface UnderstandFirstStepsProps {
  applicationName: string;
  /** Whether the assess stage has produced the item catalog the runs are chosen from. */
  hasCatalog: boolean;
  /** An understand run is queued or running: its views appear after its pull request is merged. */
  running: boolean;
  onOpenCatalog: () => void;
  onOpenRuns: () => void;
}

const STEPS = [
  { title: "Pick items in the Catalog", detail: "Select items or whole modules, or let the AI plan or Quick pick choose a first batch." },
  { title: "Run understand", detail: "Each run analyses its items and opens one pull request with their specifications, rules, security findings and traceability." },
  { title: "Merge the pull request", detail: "The views here (units, topology, rules, security, gaps) are rebuilt from the merged items; Rebuild generated views does it on demand." },
];

export function UnderstandFirstSteps({ applicationName, hasCatalog, running, onOpenCatalog, onOpenRuns }: UnderstandFirstStepsProps): React.JSX.Element {
  return (
    <Card className="p-0">
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-[10px] tracking-wide text-text-muted uppercase">understand · {applicationName}</p>
            <h2 className="mt-1 text-[18px] leading-tight font-semibold tracking-[-0.3px] text-text">
              {running ? "An understand run is in progress" : hasCatalog ? "No item has been understood yet" : "There is no item catalog yet"}
            </h2>
            <p className="mt-1.5 max-w-prose text-[13px] text-text-secondary">
              {running
                ? "These views fill in once its pull request is merged. You can select more items in the Catalog meanwhile."
                : hasCatalog
                  ? "Start in the Catalog: choose the items to analyse and run understand on them. The views here fill in after the pull request is merged."
                  : "Run assess and merge its pull request first: it builds the catalog that understand runs are chosen from."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="solid" onClick={onOpenCatalog}>
              <ListTree className="size-3.5" />
              {hasCatalog ? "Go to the Catalog" : "Open the Catalog"}
            </Button>
            {running ? (
              <Button variant="ghost" className="shadow-border" onClick={onOpenRuns}>
                Watch the run
              </Button>
            ) : null}
          </div>
        </div>

        <ol className="flex flex-col gap-0 bg-recessed/60 p-6 lg:rounded-r-xl" aria-label="What happens next">
          {STEPS.map((step, index) => {
            const current = index === 0;
            return (
              <li key={step.title} className="relative flex gap-3 pb-5 last:pb-0">
                {index === STEPS.length - 1 ? null : <span className="absolute top-6 bottom-0 left-[11px] w-px bg-hover" aria-hidden />}
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                    current ? "bg-text text-background" : "bg-surface text-text-muted shadow-border",
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-medium", current ? "text-text" : "text-text-secondary")}>{step.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-muted">{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
