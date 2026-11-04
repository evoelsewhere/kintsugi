// The wiki's report of broken links: the links of its pages to Markdown files the repository does not have, as the last
// build of the Brain found them (`GET /api/projects/:id/brain/broken`).

import { apiGet } from "./api";
import { wikiRead } from "./wiki";

/** The answer of the route: `BrainBrokenView` of `@kintsugi/domain` (P2-013); `from` is a document path, `target` the path as written. */
export interface BrokenLinksView {
  projectId: string;
  branch: string;
  commit: string;
  links: Array<{ from: string; target: string }>;
  /** The build keeps at most a fixed number of them: there may be more. */
  truncated: boolean;
}

export function fetchBrokenLinks(projectId: string, signal?: AbortSignal): Promise<BrokenLinksView> {
  return wikiRead(() => apiGet<BrokenLinksView>(`/api/projects/${encodeURIComponent(projectId)}/brain/broken`, signal));
}
