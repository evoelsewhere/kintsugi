// What may be attached to a page being edited (ADR-0098 decisions 2 and 9, ADR-0096 decision 6): a few image types and
// PDF, named safely, whose bytes are what their type says. SVG is not one of them: it can carry script. Pure.

import { isAttachmentName, isAttachmentType } from "@kintsugi/domain";

/** The most bytes of one attachment, and of all the attachments of one draft. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENTS_MAX_BYTES = 20 * 1024 * 1024;

/** The content type each extension stands for; the only types a page may hold. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean => signature.every((byte, index) => bytes[at + index] === byte);

/** The type the first bytes of a file say it is, or undefined when they are none of the allowed types. */
export function sniffAttachmentType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return undefined;
}

/** The content type of a file name's extension, when it is an allowed one. */
export function attachmentTypeOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : ATTACHMENT_TYPES[name.slice(dot + 1).toLowerCase()];
}

/**
 * A name a page's `_attachments/` folder can hold, made of what a person's file was called: no folders, letters, digits,
 * `.`, `_` and `-` only, a letter or digit first, at most 128 characters. Undefined when the extension is not an allowed type.
 */
export function safeAttachmentName(raw: string): string | undefined {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = cleaned.slice(dot);
  // A stem that ends in what replaced a space or a bracket reads badly before the dot.
  const stem = cleaned.slice(0, dot).replace(/[-_.]+$/, "").slice(0, 128 - extension.length);
  const name = `${stem}${extension}`;
  return stem !== "" && isAttachmentName(name) && isAttachmentType(name) ? name : undefined;
}

/** `name`, or `name-2`, `name-3`… before the extension, the first one not in `taken` (compared without regard to case). */
export function uniqueAttachmentName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((each) => each.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);
  for (let count = 2; ; count += 1) {
    const suffix = `-${count}`;
    const candidate = `${stem.slice(0, 128 - extension.length - suffix.length)}${suffix}${extension}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** The Markdown that shows an attachment from its page: an image inline, any other file as a link. */
export function attachmentMarkdown(name: string, contentType: string): string {
  return contentType.startsWith("image/") ? `![${name}](_attachments/${name})` : `[${name}](_attachments/${name})`;
}
