import type { GapStatus } from "@kintsugi/domain";

/** A bounded edit of a named gap at its original location, based on the document the person read. */
export interface GapAnswer {
  item: string;
  gap: string;
  commit: string;
  answer: string;
  evidence: string;
  status: GapStatus;
}
