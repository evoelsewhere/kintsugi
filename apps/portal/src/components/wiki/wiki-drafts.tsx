// The person's own drafts of wiki pages: what they started and did not publish, when it was last saved and whether a
// publish of it waits for review. Each opens in the editor; a draft is discarded only after a confirmation. Only the
// person's own drafts are listed (the API answers for the caller).

import { PencilLine } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { wikiEditApi } from "@/lib/api/wiki-edit";
import { formatRelative } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { nameOf, wikiPageLink, wikiRead } from "@/lib/wiki";
import { draftStateLabel, type DraftSummary, sortDrafts } from "@/lib/wiki-edit";

export function WikiDrafts({ projectId }: { projectId: string }): React.JSX.Element {
  const drafts = useLoader(`wiki/${projectId}/drafts`, () => wikiRead(() => wikiEditApi.drafts(projectId)));
  const [discarding, setDiscarding] = useState<DraftSummary | null>(null);
  return (
    <section aria-label="My drafts" className="flex flex-col gap-3">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">My drafts</h1>
      <Loaded loader={drafts} rows={3}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={PencilLine} title="No drafts" description="A page you start editing is kept here until you publish it or discard it." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sortDrafts(list).map((draft) => (
                <li key={draft.path} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--geist-radius)] p-3 shadow-border">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link to={wikiPageLink(projectId, draft.path, { mode: "edit" })} className="text-[13px] font-medium text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                      {nameOf(draft.path)}
                    </Link>
                    <span className="truncate font-mono text-[11px] text-text-muted" title={draft.path}>
                      {draft.path}
                    </span>
                  </div>
                  <span className="text-[12px] text-text-muted">Saved {formatRelative(draft.touchedAt)}</span>
                  <span className="rounded-full bg-recessed px-2 py-0.5 text-[11px] text-text-secondary">{draftStateLabel(draft)}</span>
                  <Button size="small" variant="danger" onClick={() => setDiscarding(draft)}>
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <ConfirmDialog
        open={discarding !== null}
        title="Discard this draft?"
        confirmLabel="Discard the draft"
        busyLabel="Discarding…"
        onClose={() => setDiscarding(null)}
        onConfirm={async () => {
          if (discarding === null) return;
          await wikiEditApi.discardDraft(projectId, discarding.path);
          await drafts.reload();
        }}
      >
        <p className="text-[13px] text-text-secondary">
          The text you wrote in <span className="font-mono">{discarding?.path}</span> is lost. The page in the wiki is not changed.
        </p>
      </ConfirmDialog>
    </section>
  );
}
