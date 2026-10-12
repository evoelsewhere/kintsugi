// The Markdown renderer (react-markdown + remark-gfm), loaded when a document is first shown.

import { lazy, Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";

const Renderer = lazy(() => import("./markdown"));

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <Renderer text={text} />
    </Suspense>
  );
}
