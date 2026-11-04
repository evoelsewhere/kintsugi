// The rules a write must meet before it is recorded and queued (design-writer-contract, section 5). The worker's writer
// checks them again for a page write, and is the last line: it does not trust the API. Pure: returns what is wrong.

import { isWikiEditablePath } from "@kintsugi/domain";
import type { DocumentWriteFile, NewDocumentWrite } from "./document-write.js";

/** The most entries one write may carry (a delete or a rename counts as one). */
export const MAX_WRITE_ENTRIES = 500;
/** The most bytes of one file (decoded), and of all files of a write. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_WRITE_BYTES = 50 * 1024 * 1024;

const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const WRITER_BRANCH = /^kintsugi\/[A-Za-z0-9._/-]+$/;

/** The bytes a file's content stands for. */
export function contentBytes(file: Pick<DocumentWriteFile, "content" | "encoding">): number {
  if (file.encoding !== "base64") return Buffer.byteLength(file.content, "utf8");
  const padding = file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0;
  return Math.floor((file.content.length * 3) / 4) - padding;
}

/** A path that cannot be written anywhere: not relative, not forward-slashed, with `.`, `..` or empty segments, or inside `.git`. */
function unsafePath(path: string): string | undefined {
  if (path === "") return "is empty";
  if (CONTROL.test(path)) return "has control characters";
  if (path.includes("\\")) return "has backslashes";
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) return "is absolute";
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return "has an empty, '.' or '..' segment";
    if (segment.toLowerCase() === ".git") return "is inside .git";
  }
  return undefined;
}

/** What is wrong with the write, in the order found; empty when it may be recorded. */
export function documentWriteProblems(write: Pick<NewDocumentWrite, "kind" | "files" | "directPublish" | "continues" | "page">): string[] {
  const problems: string[] = [];
  const { files } = write;
  const page = write.kind === "page";
  if (files.length === 0) problems.push("A write needs at least one file");
  if (files.length > MAX_WRITE_ENTRIES) problems.push(`A write carries at most ${MAX_WRITE_ENTRIES} files (a delete or a rename counts as one); this one has ${files.length}`);

  const targets = new Set<string>();
  const sources = new Set<string>();
  let total = 0;
  for (const file of files) {
    const where = `"${file.path.replace(CONTROL, "?")}"`;
    const check = (condition: boolean, message: string): void => {
      if (!condition) problems.push(`${where}: ${message}`);
    };
    const wrong = unsafePath(file.path);
    check(wrong === undefined, `the path ${wrong ?? ""}`);
    if (page && wrong === undefined) check(isWikiEditablePath(file.path), "is not a page or attachment that can be edited");
    check(!targets.has(file.path), "is written twice in one write");
    targets.add(file.path);

    const bytes = contentBytes(file);
    total += bytes;
    check(bytes <= MAX_FILE_BYTES, `is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MiB`);
    if (file.encoding === "base64") check(BASE64.test(file.content), "content is not valid base64");
    if (page && file.encoding !== "base64" && /(^|\/)_attachments\//.test(file.path)) check(false, "an attachment is binary: send it as base64");

    if (file.expectedHash !== undefined) check(SHA256.test(file.expectedHash), "expectedHash is not a SHA-256 in hex");
    if (file.delete === true) {
      check(file.expectedHash !== undefined, "a delete needs expectedHash, the hash of the file as it was seen");
      check(file.renameFrom === undefined && file.createOnly !== true && file.content === "", "a delete has no content, rename or createOnly");
    }
    if (file.renameFrom !== undefined) {
      const old = unsafePath(file.renameFrom);
      check(old === undefined, `renameFrom ${old ?? ""}`);
      check(file.renameFrom !== file.path, "renameFrom is the same path");
      check(file.expectedHash !== undefined, "a rename needs expectedHash, the hash of the file it moves");
      check(file.createOnly !== true, "a rename is not createOnly");
      if (page && old === undefined) check(isWikiEditablePath(file.renameFrom), `renameFrom "${file.renameFrom}" is not a page or attachment that can be edited`);
      check(!sources.has(file.renameFrom), `renameFrom "${file.renameFrom}" is moved twice`);
      sources.add(file.renameFrom);
    }
  }
  for (const file of files) {
    if (file.renameFrom !== undefined && targets.has(file.renameFrom)) problems.push(`"${file.renameFrom}" is moved and also written by another entry`);
  }
  if (total > MAX_WRITE_BYTES) problems.push(`A write carries at most ${MAX_WRITE_BYTES / (1024 * 1024)} MiB; this one has ${Math.ceil(total / (1024 * 1024))} MiB`);

  if (page) {
    if (write.page === undefined) problems.push("A page write names its page");
    else if (unsafePath(write.page.path) !== undefined || !isWikiEditablePath(write.page.path)) problems.push(`"${write.page.path}" is not a page or attachment that can be edited`);
    if (write.continues !== undefined && !WRITER_BRANCH.test(write.continues)) problems.push("continues must be a kintsugi/* branch");
  } else {
    if (write.page !== undefined) problems.push("Only a page write names a page");
    if (write.directPublish !== undefined) problems.push("Only a page write can publish directly");
    if (write.continues !== undefined) problems.push("Only a page write can continue a branch");
    for (const file of files) {
      if (file.delete === true || file.renameFrom !== undefined) problems.push(`"${file.path}": only a page write can delete or rename`);
    }
  }
  return problems;
}
