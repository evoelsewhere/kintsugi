// The Markdown renderer (react-markdown + remark-gfm), loaded when a document is first shown.

import { lazy, Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";

const Renderer = lazy(() => import("./markdown"));

/** `path`: the document's path in the document repo, for its relative links. */
export function Markdown({ text, path }: { text: string; path?: string | undefined }): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <Renderer text={text} path={path} />
    </Suspense>
  );
}
