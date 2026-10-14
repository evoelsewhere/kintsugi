// A read-only code view, VS Code style (CodeMirror), loaded when first shown.

import { lazy, Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";

const Editor = lazy(() => import("./code-editor"));

/** `path` picks the language from the file extension. */
export function CodeView({ text, path }: { text: string; path: string }): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={10} />}>
      <Editor text={text} path={path} />
    </Suspense>
  );
}
