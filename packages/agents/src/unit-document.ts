import { parseWorkItemFile, type ValidationProblem, type ValidationResult, type WorkItemFile } from "@kintsugi/domain";
import { splitFrontmatter } from "./format.js";

export const MAX_UNIT_DOCUMENT_BYTES = 256 * 1024;

/**
 * Strictly parses the authoritative unit-card README.md frontmatter with the shared domain schema.
 * The optional path identity prevents a valid file from being indexed under another unit.
 */
export function parseUnitDocument(markdown: string, expectedUnitId?: string): ValidationResult<WorkItemFile> {
  if (Buffer.byteLength(markdown, "utf8") > MAX_UNIT_DOCUMENT_BYTES) {
    return { ok: false, issues: [{ path: "", message: "unit document exceeds the 262144-byte limit" }] };
  }

  const document = splitFrontmatter(markdown, "README.md");
  if (typeof document === "string") {
    return {
      ok: false,
      issues: [{
        path: "",
        message: document.includes("missing YAML frontmatter") ? "unit document is missing YAML frontmatter" : "unit document has invalid YAML frontmatter",
      }],
    };
  }

  const result = parseWorkItemFile(document.data);
  if (!result.ok) return result;
  if (expectedUnitId !== undefined && result.value.id !== expectedUnitId) {
    const issue: ValidationProblem = { path: "id", message: "must match the unit path" };
    return { ok: false, issues: [issue] };
  }
  return result;
}
