// The wiki (ADR-0096, ADR-0097): the project's document repository read as pages. The page tree is on the left and the
// page, or the folder, named by the address on the right: `/wiki/<path in the document repo>?project=<id>`. It reads
// the Brain's tree and the documents of the commit the Brain indexed, so it needs the Brain on; nothing is written here.

import { BookText, FolderKanban, ListTree, TriangleAlert, Unlink } from "lucide-react";
import { useMemo } from "react";
import { Link, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { ProjectNotFound, ProjectSelector } from "@/components/project-selector";
import { DocumentLinksProvider } from "@/components/results/document-links";
import { MarkdownImagesContext } from "@/components/results/use-markdown-images";
import { StickyHeader } from "@/components/sticky-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { BrokenLinksPanel } from "@/components/wiki/broken-links-panel";
import { WikiLabelPage } from "@/components/wiki/wiki-label-page";
import { WikiFolderView } from "@/components/wiki/wiki-folder-view";
import { WikiPageView } from "@/components/wiki/wiki-page-view";
import { WikiSearchBox } from "@/components/wiki/wiki-search-box";
import { WikiSearchResults } from "@/components/wiki/wiki-search-results";
import { WikiTree } from "@/components/wiki/wiki-tree";
import { brainApi } from "@/lib/api/brain";
import { projectsApi } from "@/lib/api/projects";
import { projectLink } from "@/lib/links";
import { useProjectSelection } from "@/lib/project-selection";
import { useLoader } from "@/lib/use-loader";
import { isPagePath, pathOfSplat, readWikiSearch, WIKI_BASE, wikiIsOff, type WikiProjectFlag, wikiLink, wikiRead } from "@/lib/wiki";

export function WikiPage(): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  const { projectId, select, notFound } = useProjectSelection(projects.data?.map((project) => project.id));
  const current = projects.data?.find((project) => project.id === projectId);
  const navigate = useNavigate();
  const routeParams = useParams();
  const path = pathOfSplat(routeParams["*"]);
  // `/wiki/-/label/<label>` is the page of a label; any other address is a path of the document repo.
  const label = routeParams["label"];

  return (
    <div className="flex flex-col gap-4">
      <StickyHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Breadcrumbs items={current === undefined ? ["Wiki"] : ["Wiki", current.name]} />
        {projects.data === undefined || projects.data.length === 0 ? null : (
          <ProjectSelector
            projects={projects.data}
            value={projectId}
            onChange={(id) => {
              select(id);
              // A page belongs to its project: another project opens at its root.
              if (id !== projectId) void navigate(wikiLink(id, ""));
            }}
          />
        )}
      </StickyHeader>
      {notFound === undefined ? null : <ProjectNotFound requested={notFound} shown={current?.name} />}
      <Loaded loader={projects} rows={4}>
        {(list) =>
          list.length === 0 || projectId === undefined ? (
            <Card>
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="The wiki shows a project's document repository. Create a project with its document repository first."
                action={
                  <Link to="/projects" className="text-[13px] text-accent hover:underline">
                    Go to Administration → Projects
                  </Link>
                }
              />
            </Card>
          ) : wikiIsOff(current as WikiProjectFlag | undefined) ? (
            <Card>
              <EmptyState
                icon={BookText}
                title="Wiki is off for this project"
                description="Turn the wiki on for the project to read its document repository here. Nothing was loaded."
                action={
                  <Link to={projectLink(projectId)} className="text-[13px] text-accent hover:underline">
                    Configure the project
                  </Link>
                }
              />
            </Card>
          ) : (
            <WikiProject key={projectId} projectId={projectId} projectName={current?.name ?? projectId} path={path} label={label} />
          )
        }
      </Loaded>
    </div>
  );
}

/** The reader of one project: it opens once the Brain has a tree, and says what is missing until then. */
function WikiProject({ projectId, projectName, path, label }: { projectId: string; projectName: string; path: string; label: string | undefined }): React.JSX.Element {
  const status = useLoader(`wiki/${projectId}/status`, () => wikiRead(() => brainApi.status(projectId)), { live: [`brain:${projectId}`, `repositories`] });
  return (
    <Loaded loader={status} rows={6}>
      {(view) => {
        if (!view.available) {
          return (
            <Card>
              <EmptyState
                icon={FolderKanban}
                title="No document repository to read yet"
                description={view.reason ?? "Link the project's document repository; the wiki shows it once the worker has mirrored it."}
                action={
                  <Link to={projectLink(projectId)} className="text-[13px] text-accent hover:underline">
                    Configure the project
                  </Link>
                }
              />
            </Card>
          );
        }
        if (view.enabled && view.commit !== null) {
          // A rebuild of the same commit (a newer builder) changes the tree too: the build time keys what was loaded.
          return <WikiReader key={view.indexedAt ?? view.commit} projectId={projectId} commit={view.commit} path={path} label={label} />;
        }
        const building = view.state === "queued" || view.state === "indexing";
        const failed = view.state === "failed";
        return (
          <Card>
            <EmptyState
              icon={failed ? TriangleAlert : ListTree}
              title={building ? `Building the index of ${projectName}…` : failed ? "The index could not be built" : "The index is not built"}
              description={
                building
                  ? "The wiki reads the Brain's tree; this page follows the build and opens the pages when it is ready."
                  : failed
                    ? `The last build failed${view.error === null ? "" : `: ${view.error}`}`
                    : "The wiki reads the Brain's tree, which is off or not built for this project. A person who manages the Brain turns it on."
              }
              action={
                <Link to={`/brain?project=${encodeURIComponent(projectId)}`} className="text-[13px] text-accent hover:underline">
                  Open the Brain
                </Link>
              }
            />
          </Card>
        );
      }}
    </Loaded>
  );
}

function WikiReader({ projectId, commit, path, label }: { projectId: string; commit: string; path: string; label: string | undefined }): React.JSX.Element {
  // Where the attachments of the pages are served from (the commit the Brain indexed).
  const images = useMemo(() => ({ projectId, commit }), [projectId, commit]);
  // A search is in the address (`?q=`); while there is one, its results are shown in place of the page.
  const [params] = useSearchParams();
  const search = readWikiSearch(params);
  const { q, space, label: searchLabel } = search;
  // `/wiki/-/broken` is the report of broken links; like the label page it cannot be the path of a page.
  const broken = useMatch(`${WIKI_BASE}/-/broken`) !== null;
  // The page changes with the address: a key resets what the view of the previous page held.
  const view = useMemo(
    () =>
      label !== undefined ? (
        <WikiLabelPage key={label} projectId={projectId} commit={commit} label={label} />
      ) : broken ? (
        <BrokenLinksPanel projectId={projectId} />
      ) : q !== "" ? (
        <WikiSearchResults projectId={projectId} commit={commit} search={{ q, space, label: searchLabel }} />
      ) : isPagePath(path) ? (
        <WikiPageView key={path} projectId={projectId} commit={commit} path={path} />
      ) : (
        <WikiFolderView key={path} projectId={projectId} commit={commit} path={path} />
      ),
    [projectId, commit, path, label, broken, q, space, searchLabel],
  );
  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-xl bg-surface shadow-border-medium lg:h-[calc(100vh-var(--page-header-height,0px)-8rem)] lg:flex-row">
      <aside
        className="flex max-h-[45vh] shrink-0 flex-col [box-shadow:0_1px_0_rgba(0,0,0,0.08)] lg:max-h-none lg:w-72 lg:[box-shadow:1px_0_0_rgba(0,0,0,0.08)] xl:w-80"
        aria-label="Pages"
      >
        <div className="p-2 pb-0">
          <WikiSearchBox key={search.q} projectId={projectId} search={search} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <WikiTree projectId={projectId} selectedPath={path} />
        </div>
        <div className="p-2 pt-0 text-[12px]">
          <Link to={`${WIKI_BASE}/-/broken?project=${encodeURIComponent(projectId)}`} className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-text-muted hover:text-text hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
            <Unlink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Broken links
          </Link>
        </div>
      </aside>
      <section className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6" aria-label="Page">
        <MarkdownImagesContext.Provider value={images}>
          <DocumentLinksProvider projectId={projectId} commit={commit}>
            {view}
          </DocumentLinksProvider>
        </MarkdownImagesContext.Provider>
      </section>
    </div>
  );
}
