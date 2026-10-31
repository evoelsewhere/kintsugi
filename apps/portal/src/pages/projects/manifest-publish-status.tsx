// The latest publication of kintsugi.yaml (a document write of kind `manifest`, ADR-0019) on the
// project page: its status and its pull request, followed live until the pull request is merged.

import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { WriteStatusBadge } from "@/components/status-badges";
import type { DocumentWriteView } from "@/lib/api/projects";
import { formatDateTime, formatRelative } from "@/lib/format";
import { deliveryLink } from "@/lib/links";

/** The newest manifest write, while it still needs someone (anything but merged). */
function pendingManifestWrite(writes: readonly DocumentWriteView[]): DocumentWriteView | undefined {
  const latest = writes.filter((write) => write.kind === "manifest").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest === undefined || latest.status === "merged" ? undefined : latest;
}

const NEXT_STEP: Record<string, string> = {
  queued: "The worker commits it shortly.",
  committed: "Pushed to its branch, with no pull request (the Git server has none, or no API token): propose or merge the branch yourself.",
  "pr-opened": "Review and merge the pull request; the project uses the new kintsugi.yaml once it is merged.",
  closed: "The pull request was closed without merging. Publish again to propose it anew.",
  unchanged: "The document repo already has this kintsugi.yaml and structure.",
  failed: "Publishing failed. Fix the cause and publish again.",
};

export function ManifestPublishStatus({ projectId, writes }: { projectId: string; writes: readonly DocumentWriteView[] }): React.JSX.Element | null {
  const write = pendingManifestWrite(writes);
  if (write === undefined) return null;
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--geist-radius)] bg-recessed px-3 py-2 text-[13px]">
      <span className="text-text-secondary">Last publish</span>
      <WriteStatusBadge status={write.status} />
      <span className="text-[12px] text-text-muted" title={formatDateTime(write.createdAt)}>
        {formatRelative(write.updatedAt)}
        {write.actor === undefined ? "" : ` · by ${write.actor}`}
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-text-secondary">{write.error ?? NEXT_STEP[write.status] ?? ""}</span>
      {write.prUrl === undefined ? (
        <Link to={deliveryLink({ projectId, section: "writes" })} className="text-[12px] text-accent hover:underline">
          Document writes
        </Link>
      ) : (
        <a href={write.prUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[12px] text-accent hover:underline">
          Pull request
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
