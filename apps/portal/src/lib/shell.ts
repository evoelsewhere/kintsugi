// Panel shell context, shared with the pages rendered in its <Outlet>: pages can open the
// settings modal on a given section (e.g. "git" to register repositories).

import { useOutletContext } from "react-router-dom";

export interface ShellContext {
  /** Opens the settings modal, optionally on a section; `onClose` runs when it closes. */
  openSettings: (tab?: string, onClose?: () => void) => void;
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>();
}
