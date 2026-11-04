// Two versions of a page side by side in one column: the lines that were added or removed, with the line numbers of
// the older and of the newer version. The text of every line is shown as text, never as HTML.

import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { documentsApi } from "@/lib/api/documents";
import { shortSha } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { compareSummary, wikiPageLink, wikiRead } from "@/lib/wiki";

export interface WikiCompareProps {
  projectId: string;
  path: string;
  /** The older and the newer version, as commit ids. */
  from: string;
  to: string;
}

const MARK = { context: " ", add: "+", del: "−" } as const;

export function WikiCompare({ projectId, path, from, to }: WikiCompareProps): React.JSX.Element {
  const result = useLoader(`wiki/${projectId}/compare/${path}/${from}/${to}`, () => wikiRead(() => documentsApi.compare(projectId, path, from, to)));
  return (
    <section aria-label="Comparison of two versions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-muted">
        <p>
          <Link to={wikiPageLink(projectId, path, { mode: "version", sha: from })} className="font-mono text-text-secondary hover:underline">
            {shortSha(from)}
          </Link>
          {" → "}
          <Link to={wikiPageLink(projectId, path, { mode: "version", sha: to })} className="font-mono text-text-secondary hover:underline">
            {shortSha(to)}
          </Link>
        </p>
        <Link to={wikiPageLink(projectId, path, { mode: "history" })} className="text-accent hover:underline">
          Back to the history
        </Link>
      </div>
      <Loaded loader={result} rows={6}>
        {(diff) => (
          <>
            <p role="status" className="text-[13px] text-text">
              {compareSummary(diff)}
            </p>
            {diff.hunks.map((hunk) => (
              <div key={`${hunk.oldStart}:${hunk.newStart}`} className="overflow-x-auto rounded-lg bg-recessed font-mono text-[12px] leading-5">
                <p className="px-3 py-1 text-text-muted">{`@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</p>
                <table className="w-full border-collapse">
                  <tbody>
                    {hunk.lines.map((line, index) => (
                      <tr
                        key={index}
                        className={cn(
                          line.type === "add" && "bg-[color-mix(in_srgb,var(--ds-status-green)_14%,transparent)]",
                          line.type === "del" && "bg-[color-mix(in_srgb,var(--ds-status-red)_14%,transparent)]",
                        )}
                      >
                        <td className="w-10 px-2 text-right text-text-muted select-none">{line.oldLine ?? ""}</td>
                        <td className="w-10 px-2 text-right text-text-muted select-none">{line.newLine ?? ""}</td>
                        <td className="w-4 text-text-muted select-none" aria-label={line.type === "add" ? "added" : line.type === "del" ? "removed" : undefined}>
                          {MARK[line.type]}
                        </td>
                        <td className="pr-3 break-words whitespace-pre-wrap text-text-secondary">{line.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      </Loaded>
    </section>
  );
}
