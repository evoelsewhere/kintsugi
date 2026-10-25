/** Published reference IDs (ADR-0075). Scope belongs to an application catalog, not a database key. */
export const DOCUMENT_REFERENCE_TYPES = ["RULE", "SEC", "GAP"] as const;
export type DocumentReferenceType = (typeof DOCUMENT_REFERENCE_TYPES)[number];

/** A module abbreviation followed by its immutable unit number, e.g. CARD01. */
export const DOCUMENT_REFERENCE_SCOPE_PATTERN = /^[A-Z][A-Z0-9]{1,15}$/;
export const DOCUMENT_REFERENCE_ID_PATTERN = /^(RULE|SEC|GAP)-([A-Z][A-Z0-9]{1,15})-([0-9]{4,})$/;

export function documentReferenceId(type: DocumentReferenceType, scope: string, sequence: number): string {
  if (!DOCUMENT_REFERENCE_TYPES.includes(type) || !DOCUMENT_REFERENCE_SCOPE_PATTERN.test(scope) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Invalid document reference type, scope or sequence");
  }
  return `${type}-${scope}-${String(sequence).padStart(4, "0")}`;
}
