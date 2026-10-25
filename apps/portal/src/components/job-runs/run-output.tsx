import { ExternalLink, FileText, Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { WriteStatusBadge } from "@/components/status-badges";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import type { JobRunDetail } from "@/lib/api/job-runs";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/format";

export function RunOutput({ run }: { run: JobRunDetail }): React.JSX.Element {
  const [search, setSearch] = useState("");
  const { can } = useAuth();
  const query = search.trim().toLowerCase();
  const files = run.artifacts.filter((file) => file.path.toLowerCase().includes(query));
  const size = run.artifacts.reduce((sum, file) => sum + file.size, 0);
  const restricted = run.restrictedRecords + run.steps.reduce((sum, step) => sum + step.restrictedRecords, 0);
  const write = run.documentWrite;
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl bg-recessed/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-text">Document delivery</h2>
            <p className="mt-1 text-[13px] text-text-secondary">
              {run.artifacts.length} files · {formatBytes(size)}
            </p>
          </div>
          {write === undefined ? (
            <span className="text-[13px] text-text-secondary">No document write recorded</span>
          ) : (
            <WriteStatusBadge status={write.status} />
          )}
        </div>
        {write?.branch === undefined ? null : (
          <div className="mt-3 flex min-w-0 items-center gap-2">
            <span className="text-[12px] text-text-secondary">Branch</span>
            <code className="min-w-0 flex-1 break-all text-[12px] text-text">{write.branch}</code>
            <CopyButton value={write.branch} label="Copy branch" iconOnly />
          </div>
        )}
        {write?.prUrl === undefined ? null : (
          <a
            href={write.prUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          >
            Open pull request <ExternalLink className="size-3.5" />
          </a>
        )}
        {write?.error === undefined ? null : (
          <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-[13px] text-text">
            {write.error}
          </p>
        )}
      </section>
      <section className="min-w-0 rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-text">Output files</h2>
            <p className="mt-1 text-[12px] text-text-secondary">
              {files.length} of {run.artifacts.length} files
            </p>
          </div>
          <label className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-text-muted" />
            <Input
              size="small"
              type="search"
              aria-label="Search output files"
              placeholder="Search file path…"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {files.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-text-secondary">
            {run.artifacts.length === 0
              ? run.status === "succeeded"
                ? "This run produced no output files."
                : "Output files appear after the run succeeds."
              : "No files match this search."}
          </p>
        ) : (
          <ul className="max-h-[560px] overflow-y-auto [scrollbar-gutter:stable]" aria-label="Output files">
            {files.map((file) => (
              <li key={file.path} className="flex min-w-0 items-start gap-3 rounded-lg px-2 py-3 hover:bg-hover">
                <FileText className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="break-all text-[13px] font-medium text-text">{file.path.split("/").at(-1)}</p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5 text-text-secondary">{file.path}</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {file.provenance.runtimeAgent ?? file.provenance.origin} · {formatBytes(file.size)}
                  </p>
                </div>
                <CopyButton value={file.path} label={`Copy ${file.path}`} iconOnly />
              </li>
            ))}
          </ul>
        )}
      </section>
      {restricted === 0 ? null : (
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
          <ShieldAlert className="size-4" />
          {restricted} restricted records kept outside the document repository.
          {can("restricted.read") ? (
            <Link to={`/governance?tab=restricted&run=${encodeURIComponent(run.id)}`} className="text-accent hover:underline">
              Open in Governance
            </Link>
          ) : null}
        </p>
      )}
    </div>
  );
}
