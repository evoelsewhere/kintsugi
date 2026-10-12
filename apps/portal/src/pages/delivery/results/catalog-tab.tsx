// The Catalog tab of the assess stage (ADR-0033): the item catalog on the default branch with
// the derived status of every item. Loaded lazily with the result views.

import { ListTree } from "lucide-react";
import { Loaded } from "@/components/loaded";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api";
import { catalogApi } from "@/lib/api/catalog";
import type { ApplicationView, ProjectDetail } from "@/lib/api/projects";
import { useLoader } from "@/lib/use-loader";
import { CatalogResults } from "./catalog-view";

export interface CatalogTabProps {
  project: ProjectDetail;
  application: ApplicationView;
  /** Changes when a run finishes, so the catalog and the statuses are read again. */
  version: string;
}

export default function CatalogTab({ project, application, version }: CatalogTabProps): React.JSX.Element {
  const catalog = useLoader(
    `catalog/${project.id}/${application.id}/${version}`,
    () =>
      catalogApi.get(project.id, application.id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    { refresh: (view) => (view?.items.some((item) => item.status === "running") === true ? 5000 : 30000) },
  );
  return (
    <Loaded loader={catalog} rows={6}>
      {(view) =>
        view === null ? (
          <Card>
            <EmptyState icon={ListTree} title="No item catalog yet" description="Run assess and merge its pull request: it builds the catalog the understand stage runs on." />
          </Card>
        ) : (
          <CatalogResults view={view} />
        )
      }
    </Loaded>
  );
}
