// Where the attachments of a rendered Markdown document are served from (see markdown-image.tsx): a view that knows the
// project and the commit of its documents (the wiki reader) provides it; without it no image of the repository is shown.

import { createContext } from "react";

export interface MarkdownImages {
  projectId: string;
  commit: string;
}

export const MarkdownImagesContext = createContext<MarkdownImages | null>(null);
