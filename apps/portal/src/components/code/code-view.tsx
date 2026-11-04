// A code view, VS Code style (CodeMirror), read-only or editable, loaded when first shown.

import { lazy, Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";

const Editor = lazy(() => import("./code-editor"));

/** `path` picks the language from the file extension. */
export function CodeView({
  text,
  path,
  onChange,
  lineSeparator,
  registerInsert,
  onFiles,
}: {
  text: string;
  path: string;
  onChange?: ((text: string) => void) | undefined;
  lineSeparator?: string | undefined;
  registerInsert?: ((apply: (plan: (text: string, cursor: number) => { from: number; to: number; insert: string }) => void) => void) | undefined;
  onFiles?: ((files: File[]) => void) | undefined;
}): React.JSX.Element {
  return (
    <Suspense fallback={<SkeletonRows rows={10} />}>
      <Editor text={text} path={path} onChange={onChange} lineSeparator={lineSeparator} registerInsert={registerInsert} onFiles={onFiles} />
    </Suspense>
  );
}
