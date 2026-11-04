// "Export Markdown" of a wiki page: saves the text the page shows (the current version or an older one) as the .md file
// it is in the repository. The text is handed in; nothing is fetched here.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadMarkdown, exportFileName } from "@/lib/wiki-export";

export interface ExportMarkdownButtonProps {
  /** The page's repository path; its last segment names the file. */
  path: string;
  /** The page's Markdown source at the commit being shown. */
  text: string;
}

export function ExportMarkdownButton({ path, text }: ExportMarkdownButtonProps): React.JSX.Element {
  return (
    <Button size="small" variant="ghost" title={`Save ${exportFileName(path)}`} onClick={() => downloadMarkdown(exportFileName(path), text)}>
      <Download className="size-4" strokeWidth={1.5} />
      Export Markdown
    </Button>
  );
}
