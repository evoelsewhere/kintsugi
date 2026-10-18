// Where a link inside an agent-written document points. Relative links resolve against the
// document's path in the document repo; a link that leaves the repo, points under restricted/
// or .git, or uses a non-web scheme is never followed.

import { applicationsDir, assessmentFilePath, generatedFilePath } from "@kintsugi/domain";

export type LinkTarget =
  /** A web page: opens in a new tab. */
  | { kind: "external"; href: string }
  /** A file of the document repo (`path` is repo-relative), with the fragment when there is one. */
  | { kind: "document"; path: string; anchor?: string }
  /** Not followed: outside the repo, restricted, or an unsupported scheme. */
  | { kind: "blocked"; reason: string };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Normalizes `a/./b/../c` to `a/c`; null when the path climbs out of the root. */
function normalize(segments: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
}

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** Resolves a repo-relative `href` written in the document at `basePath`. */
export function resolveDocumentLink(href: string, basePath: string): LinkTarget {
  const trimmed = href.trim();
  const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return scheme === "http" || scheme === "https" ? { kind: "external", href: trimmed } : { kind: "blocked", reason: `${scheme}: links are not followed` };
  }
  if (trimmed.startsWith("//")) return { kind: "blocked", reason: "protocol-relative links are not followed" };

  const hash = trimmed.indexOf("#");
  const beforeHash = hash < 0 ? trimmed : trimmed.slice(0, hash);
  const anchor = hash < 0 ? "" : decode(trimmed.slice(hash + 1));
  const pathPart = decode(beforeHash.split("?")[0] ?? "");

  const baseDir = basePath.split("/").slice(0, -1);
  const segments = pathPart === "" ? basePath.split("/") : pathPart.startsWith("/") ? pathPart.split("/") : [...baseDir, ...pathPart.split("/")];
  const resolved = normalize(segments.flatMap((segment) => segment.split("\\")));
  if (resolved === null || resolved.length === 0) return { kind: "blocked", reason: "the link leaves the document repo" };
  if (resolved.some((segment) => /^(restricted|\.git)$/i.test(segment))) return { kind: "blocked", reason: "restricted records are never opened from a document" };

  return { kind: "document", path: resolved.join("/"), ...(anchor !== "" && { anchor }) };
}

/** The application whose folder a document-repo path is in, from the domain-owned root. */
function applicationIdOf(path: string): string | undefined {
  const [root, app, ...rest] = path.split("/");
  return root === applicationsDir() && app !== undefined && rest.length >= 2 ? app : undefined;
}

/** Stage main documents, built through the domain path helpers (ADR-0038). */
const MAIN_DOCUMENT_STAGES: ReadonlyArray<readonly [(app: string) => string, string]> = [
  [(app) => assessmentFilePath(app, "ASSESSMENT.md"), "assess"],
  [(app) => assessmentFilePath(app, "SECURITY_FINDINGS.md"), "harden"],
  [(app) => assessmentFilePath(app, "BUSINESS_RULES.md"), "extract-rules"],
  [(app) => generatedFilePath(app, "README.md"), "understand"],
  [(app) => generatedFilePath(app, "architecture.md"), "understand"],
  [(app) => generatedFilePath(app, "data-model.md"), "understand"],
  [(app) => generatedFilePath(app, "integrations.md"), "understand"],
];

/** The stage whose main document `path` is, for an "open in results" link. */
export function stageOfDocument(path: string): { stage: string; app: string } | undefined {
  const app = applicationIdOf(path);
  if (app === undefined) return undefined;
  for (const [document, stage] of MAIN_DOCUMENT_STAGES) {
    if (document(app) === path) return { stage, app };
  }
  return undefined;
}

/** The id among `ids` an anchor names (`#sec-001`, `#sec-001--sql-injection`): the longest id the anchor starts with. */
export function idOfAnchor(anchor: string | undefined, ids: Iterable<string>): string | undefined {
  if (anchor === undefined) return undefined;
  const wanted = anchor.toLowerCase();
  let best: string | undefined;
  for (const id of ids) {
    const lower = id.toLowerCase();
    if ((wanted === lower || wanted.startsWith(`${lower}-`) || wanted.startsWith(`${lower}_`)) && (best === undefined || id.length > best.length)) best = id;
  }
  return best;
}
