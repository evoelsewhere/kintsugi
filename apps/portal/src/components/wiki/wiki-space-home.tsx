// The home page of a space: the README of the space's folder, shown as any page of the wiki. A space without one says
// so and lists the pages the Brain knows in it, so the space can still be entered.

import { FileText, LayoutPanelTop } from "lucide-react";
import { Link } from "react-router-dom";
import { Loaded } from "@/components/loaded";
import { EmptyState } from "@/components/ui/empty-state";
import { brainApi } from "@/lib/api/brain";
import { useLoader } from "@/lib/use-loader";
import { spacePages, spaceHomePath, wikiLink, wikiRead } from "@/lib/wiki";
import { WikiPageView } from "./wiki-page-view";

export interface WikiSpaceHomeProps {
  projectId: string;
  /** The commit the Brain indexed. */
  commit: string;
  /** The space's key, in any case. */
  space: string;
}

export function WikiSpaceHome({ projectId, commit, space }: WikiSpaceHomeProps): React.JSX.Element {
  const key = space.toUpperCase();
  const found = useLoader(`wiki/${projectId}/${commit}/space/${key}`, () => wikiRead(() => brainApi.lookup(projectId, `space:${key}`)));
  return (
    <Loaded loader={found} rows={4}>
      {(view) => {
        const home = spaceHomePath(view.matches, key);
        if (home !== undefined) return <WikiPageView projectId={projectId} commit={commit} path={home} />;
        const pages = spacePages(view.matches);
        return (
          <section aria-label={`Space ${key}`} className="flex flex-col gap-3">
            <h1 className="text-[20px] font-semibold tracking-tight text-text">Space {key}</h1>
            {pages.length === 0 ? (
              <EmptyState icon={LayoutPanelTop} title="No such space" description={`The wiki has no page in a space with the key “${key}”.`} />
            ) : (
              <>
                <p className="text-[12px] text-text-muted">This space has no home page (a README with `key: {key}`). Its pages:</p>
                <ul className="flex flex-col gap-1">
                  {pages.map((page) => (
                    <li key={page.path}>
                      <Link to={wikiLink(projectId, page.path)} className="flex items-center gap-2 text-[13px] text-accent hover:underline">
                        <FileText className="size-3.5 text-text-muted" strokeWidth={1.5} aria-hidden="true" />
                        {page.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      }}
    </Loaded>
  );
}
