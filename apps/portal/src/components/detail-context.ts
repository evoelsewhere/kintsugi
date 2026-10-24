// What the detail host (detail-page.tsx) shares with the detail pages and the breadcrumbs.

import * as React from "react";
import type { Crumb } from "./breadcrumbs";

export interface DetailEntry {
  id: symbol;
  title: string;
  onClose: () => void;
}

export interface DetailContextValue {
  slot: HTMLElement | null;
  stack: readonly DetailEntry[];
  register: (entry: DetailEntry) => () => void;
  setBase: (items: Crumb[]) => void;
}

export const DetailContext = React.createContext<DetailContextValue | null>(null);

/** The trail of the page underneath: its Breadcrumbs publish it so the detail can extend it. */
export function usePublishBreadcrumbs(items: Crumb[]): void {
  const host = React.useContext(DetailContext);
  const setBase = host?.setBase;
  const key = JSON.stringify(items);
  React.useEffect(() => {
    setBase?.(JSON.parse(key) as Crumb[]);
    return () => setBase?.([]);
  }, [setBase, key]);
}
