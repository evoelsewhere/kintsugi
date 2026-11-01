// Unsaved changes of the open Settings section: a section with an edit not saved yet reports it, and the Settings modal
// asks before closing or switching section, so an admin who sets a limit and closes does not lose it unknowingly.

import { createContext, useContext, useEffect } from "react";

export interface UnsavedChangesReporter {
  report: (dirty: boolean) => void;
}

export const UnsavedChanges = createContext<UnsavedChangesReporter | null>(null);

/** Tells the Settings modal whether this section holds unsaved changes (nothing outside Settings). */
export function useUnsavedChanges(dirty: boolean): void {
  const reporter = useContext(UnsavedChanges);
  useEffect(() => {
    if (reporter === null) return;
    reporter.report(dirty);
    return () => reporter.report(false);
  }, [reporter, dirty]);
}
