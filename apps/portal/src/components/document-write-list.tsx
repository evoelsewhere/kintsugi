// A list of document writes (Delivery per project, Monitoring across projects): message,
// status, branch, commits, pull request and the failure reason.

import { ExternalLink } from "lucide-react";
import { WriteStatusBadge } from "@/components/status-badges";
import type { DocumentWriteView } from "@/lib/api/projects";
import { formatDateTime, formatRelative, shortSha } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocumentWriteList({ writes, showProject = false }: { writes: DocumentWriteView[]; showProject?: boolean }): React.JSX.Element {
  return (
    <ul className="flex flex-col">
      {writes.map((write, index) => (
        <li key={write.id} className={cn("flex items-start gap-3 px-1 py-2", index > 0 && "[box-shadow:0_-1px_0_rgba(0,0,0,0.06)]")}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-[13px] text-text">{write.message}</span>
              <WriteStatusBadge status={write.status} />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-text-muted" title={formatDateTime(write.createdAt)}>
              {formatRelative(write.updatedAt)}
              {showProject ? ` · ${write.projectId}` : ""} · {write.kind}
              {write.actor === undefined ? "" : ` · by ${write.actor}`}
              {write.agent === undefined ? "" : ` · ${write.agent}`}
              {write.branch === undefined ? "" : ` · branch ${write.branch}`}
              {write.commit === undefined ? "" : ` · commit ${shortSha(write.commit)}`}
              {write.branchCommit === undefined ? "" : ` · branch tip ${shortSha(write.branchCommit)}`}
            </p>
            {write.error === undefined ? null : <p className="mt-0.5 break-words text-[12px] text-[var(--ds-status-red)]">{write.error}</p>}
          </div>
          {write.prUrl === undefined ? null : (
            <a href={write.prUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[12px] text-accent hover:underline">
              Pull request
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
