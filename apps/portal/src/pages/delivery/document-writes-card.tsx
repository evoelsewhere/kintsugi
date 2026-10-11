// Writes of a project to its document repo (ADR-0019): what kintsugi-bot committed or proposed,
// with the branch, commit and pull request, and why a write failed. Followed while queued.

import { GitCommitHorizontal, RefreshCw } from "lucide-react";
import { DocumentWriteList } from "@/components/document-write-list";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { DocumentWriteView } from "@/lib/api/projects";
import type { Loader } from "@/lib/use-loader";

export function DocumentWritesCard({ loader, documentRepository }: { loader: Loader<DocumentWriteView[]>; documentRepository: string | undefined }): React.JSX.Element {
  return (
    <div id="document-writes" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Document writes</CardTitle>
            <CardDescription>
              Commits by kintsugi-bot to {documentRepository ?? "the document repo"}: auto-commit paths land on the default branch, the rest in pull requests.
            </CardDescription>
          </div>
          <Button size="icon" variant="ghost" aria-label="Refresh document writes" onClick={() => void loader.reload()}>
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <div className="mt-3">
          <Loaded loader={loader} rows={3}>
            {(writes) => (writes.length === 0 ? <EmptyState icon={GitCommitHorizontal} title="No writes yet" description="Publishing kintsugi.yaml and every successful stage run write here." /> : <DocumentWriteList writes={writes} />)}
          </Loaded>
        </div>
      </Card>
    </div>
  );
}
