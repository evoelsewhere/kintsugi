// The wiki's report of broken links: each page that links to a Markdown file the repository does not have, with what it
// links to. The pages open in the reader; the targets are shown as plain text, never as links.

import { FileX } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { EmptyState } from "@/components/ui/empty-state";
import { useLoader } from "@/lib/use-loader";
import { type BrokenLinksView, fetchBrokenLinks } from "@/lib/wiki-broken";
import { wikiLink } from "@/lib/wiki";

export interface BrokenLinksPanelProps {
  projectId: string;
}

/** The table for an answer already read, kept apart from the loading so it renders (and is tested) on its own. */
export function BrokenLinksTable({ projectId, view }: { projectId: string; view: BrokenLinksView }): React.JSX.Element {
  if (view.links.length === 0) return <EmptyState icon={FileX} title="No broken links" description="Every link between pages of this wiki leads to a page that exists." />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-text-muted">
        {view.links.length} broken {view.links.length === 1 ? "link" : "links"} at {view.commit.slice(0, 12)} on {view.branch}
        {view.truncated ? "; the report stops at its limit, so there may be more" : ""}.
      </p>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="text-[12px] text-text-muted">
            <th scope="col" className="py-1 pr-3 font-normal">Page</th>
            <th scope="col" className="py-1 font-normal">Links to</th>
          </tr>
        </thead>
        <tbody>
          {view.links.map((link) => (
            <tr key={`${link.from}\n${link.target}`} className="border-t border-border-subtle align-top">
              <td className="py-1.5 pr-3 break-all">
                <Link to={wikiLink(projectId, link.from)} className="text-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                  {link.from}
                </Link>
              </td>
              <td className="py-1.5 font-mono text-[12px] break-all text-text-muted">{link.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BrokenLinksPanel({ projectId }: BrokenLinksPanelProps): React.JSX.Element {
  const loader = useLoader(`wiki/${projectId}/broken`, () => fetchBrokenLinks(projectId));
  return (
    <section aria-label="Broken links" className="flex flex-col gap-3">
      <h2 className="text-[16px] font-semibold tracking-tight text-text">Broken links</h2>
      <Loaded loader={loader} rows={4}>
        {(view) => <BrokenLinksTable projectId={projectId} view={view} />}
      </Loaded>
    </section>
  );
}
