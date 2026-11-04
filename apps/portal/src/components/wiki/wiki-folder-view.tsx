// A folder of the wiki: its home page (README.md or index.md) rendered when it has one, then the pages and folders it
// holds with their summaries, in the order of the tree.

import { BRAIN_ROOT_ID, brainFolderId } from "@kintsugi/domain";
import { FileText, Folder } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { EmptyState } from "@/components/ui/empty-state";
import { brainApi } from "@/lib/api/brain";
import { useLoader } from "@/lib/use-loader";
import { homeOf, nameOf, pageEntries, wikiLink, wikiRead } from "@/lib/wiki";
import { PageTrail, WikiPageView } from "./wiki-page-view";

export interface WikiFolderViewProps {
  projectId: string;
  commit: string;
  /** The folder's path; "" for the root of the repository. */
  path: string;
}

export function WikiFolderView({ projectId, commit, path }: WikiFolderViewProps): React.JSX.Element {
  const id = path === "" ? BRAIN_ROOT_ID : brainFolderId(path);
  const level = useLoader(`wiki/${projectId}/${commit}/folder/${id}`, () => wikiRead(() => brainApi.tree(projectId, id, 0, 200)));
  return (
    <div className="flex flex-col gap-4">
      <Loaded loader={level} rows={4}>
        {(view) => {
          const entries = pageEntries(view.children);
          const home = homeOf(entries);
          const others = entries.filter((entry) => entry !== home);
          return (
            <>
              {home !== undefined ? (
                <WikiPageView projectId={projectId} commit={commit} path={home.path} />
              ) : (
                <>
                  {path === "" ? null : <PageTrail projectId={projectId} path={path} />}
                  <h1 className="text-[20px] font-semibold tracking-tight text-text">{path === "" ? "Wiki" : nameOf(path)}</h1>
                </>
              )}
              {entries.length === 0 ? (
                <EmptyState icon={FileText} title="No pages here" description="This folder holds no page that is shown in the wiki." />
              ) : others.length === 0 ? null : (
                <section aria-label="Pages in this folder" className="flex flex-col gap-1">
                  <h2 className="text-[12px] tracking-wide text-text-muted uppercase">{home === undefined ? "Pages" : "Also in this folder"}</h2>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {others.map((entry) => (
                      <li key={entry.id}>
                        <Link to={wikiLink(projectId, entry.path)} className="flex items-start gap-2 rounded-[var(--geist-radius)] p-2.5 shadow-border hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
                          {entry.kind === "folder" ? <Folder className="mt-0.5 size-4 shrink-0 text-text-muted" strokeWidth={1.5} /> : <FileText className="mt-0.5 size-4 shrink-0 text-text-muted" strokeWidth={1.5} />}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[13px] text-text">{entry.kind === "folder" ? nameOf(entry.path) : entry.title}</span>
                            {entry.summary === "" ? null : <span className="line-clamp-2 text-[12px] text-text-muted">{entry.summary}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
