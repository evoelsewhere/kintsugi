// Export of a wiki page as the Markdown file it is in the repository: the text the reader already holds, at the commit
// it shows, saved under a safe name. Nothing is fetched here.

/** `docs/Team Notes/db.md` → `db.md`: the last segment of the path, its odd characters turned into `_`, always ending `.md`. */
export function exportFileName(path: string): string {
  const last = path.split(/[/\\]/).filter((segment) => segment !== "").pop() ?? "";
  const stem = last.replace(/\.md$/i, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  return `${/^[._]*$/.test(stem) ? "page" : stem}.md`;
}

/** Saves `text` byte for byte as a `text/markdown` file; the temporary address is released once the click is done. */
export function downloadMarkdown(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
