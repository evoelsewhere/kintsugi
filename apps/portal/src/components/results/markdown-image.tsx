// The images of a rendered Markdown page. Only a view that says where the page is from (a project and a commit: the
// wiki reader) shows images of the repository, from the API's attachment route; everywhere else, and for anything that
// is not an attachment, the alt text is shown. An image of the web is never fetched by the page: it is a link.

import { ExternalLink, ImageOff } from "lucide-react";
import { useContext, useState } from "react";
import { attachmentUrl, imageSource } from "@/lib/wiki";
import { MarkdownImagesContext } from "./use-markdown-images";

export function MarkdownImage({ src, alt, basePath }: { src: string | undefined; alt: string | undefined; basePath: string | undefined }): React.JSX.Element {
  const images = useContext(MarkdownImagesContext);
  const [failed, setFailed] = useState(false);
  const text = alt === undefined || alt.trim() === "" ? "image" : alt;
  const source = basePath === undefined ? ({ kind: "none" } as const) : imageSource(src, basePath);

  if (source.kind === "external") {
    return (
      <a href={source.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline" title="An image on the web: not loaded here">
        <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        {text}
      </a>
    );
  }
  if (source.kind === "attachment" && images !== null && !failed) {
    return <img src={images.draftUrl?.(source.path) ?? attachmentUrl(images.projectId, source.path, images.commit)} alt={alt ?? ""} loading="lazy" onError={() => setFailed(true)} className="my-2 h-auto max-w-full rounded-lg" />;
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-muted" title={source.kind === "attachment" ? source.path : undefined}>
      <ImageOff className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      {text}
    </span>
  );
}
