// Guideline — how a member installs and uses the Kintsugi CLI: a sidebar of grouped pages, the page, and previous
// and next links. Inside the portal like every other page; the installers it shows are public only because curl
// cannot sign in.

import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeading } from "@/components/page-heading";
import { releasesApi } from "@/lib/api/releases";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";
import { DEFAULT_GUIDE, GUIDE_GROUPS, GUIDE_PAGES, type GuideContext } from "./guideline-pages";

function useGuideContext(): GuideContext {
  const release = useLoader("guideline/release", releasesApi.latest);
  return {
    baseUrl: release.data?.baseUrl ?? window.location.origin,
    minNode: release.data?.minNode ?? "22.19.0",
    version: release.data?.version,
    assets: release.data?.assets ?? [],
  };
}

function Sidebar({ current }: { current: string }): React.JSX.Element {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <nav aria-label="Guideline" className="flex flex-col gap-5">
      {GUIDE_GROUPS.map((group) => {
        const open = closed[group] !== true;
        return (
          <div key={group}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setClosed({ ...closed, [group]: open })}
              className="flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] tracking-widest text-text-muted uppercase hover:text-text"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {group}
            </button>
            {open ? (
              <ul className="mt-1 flex flex-col">
                {GUIDE_PAGES.filter((page) => page.group === group).map((page) => (
                  <li key={page.slug}>
                    <Link
                      to={`/guideline/${page.slug}`}
                      aria-current={page.slug === current ? "page" : undefined}
                      className={cn(
                        "block border-l-2 py-1.5 pr-2 pl-3 text-[13px]",
                        page.slug === current ? "border-[var(--ds-accent)] bg-black/[0.04] font-medium text-text dark:bg-white/[0.06]" : "border-transparent text-text-secondary hover:text-text",
                      )}
                    >
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function GuidelinePage(): React.JSX.Element {
  const { page: slug } = useParams();
  const context = useGuideContext();
  const index = GUIDE_PAGES.findIndex((entry) => entry.slug === slug);
  if (index === -1) return <Navigate to={`/guideline/${DEFAULT_GUIDE}`} replace />;
  const page = GUIDE_PAGES[index]!;
  const previous = GUIDE_PAGES[index - 1];
  const next = GUIDE_PAGES[index + 1];

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Guideline", page.title]} />
      <PageHeading title="Guideline" description="Install the Kintsugi CLI, connect your AI client and use the plugins your project offers." />
      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="shrink-0 md:sticky md:top-4 md:w-56 md:self-start">
          <Sidebar current={page.slug} />
        </aside>
        <article className="flex min-w-0 max-w-3xl flex-1 flex-col gap-3">
          <p className="font-mono text-[11px] tracking-widest text-[var(--ds-accent)] uppercase">{page.group}</p>
          <h2 className="text-[24px] font-semibold tracking-tight text-text">{page.title}</h2>
          <p className="text-[14px] text-text-muted">{page.summary}</p>
          {page.render(context)}
          <nav aria-label="Previous and next" className="mt-10 flex items-center justify-between gap-3 border-t border-black/[0.08] pt-5 text-[13px] dark:border-white/[0.1]">
            {previous === undefined ? <span /> : <Link className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text" to={`/guideline/${previous.slug}`}><ArrowLeft className="size-4" />{previous.title}</Link>}
            {next === undefined ? <span /> : <Link className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text" to={`/guideline/${next.slug}`}>{next.title}<ArrowRight className="size-4" /></Link>}
          </nav>
        </article>
      </div>
    </div>
  );
}
