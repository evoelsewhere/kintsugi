// The document title of a page: its breadcrumb trail, the page first, so tabs, the history and a screen reader tell
// pages apart ("Runs · Monitoring · Kintsugi").

export const pageTitle = (trail: readonly string[]): string => [...trail].reverse().concat("Kintsugi").join(" · ");
