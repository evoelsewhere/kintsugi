import { describe, expect, it } from "vitest";
import { canAbandonDocumentWrite } from "../src/document-write.js";

describe("releasing a completed review branch", () => {
  it("allows open, closed and manually reviewed branches", () => {
    for (const status of ["pr-opened", "closed", "committed"]) {
      expect(canAbandonDocumentWrite({ status, branch: "kintsugi/run" })).toBe(true);
    }
  });
  it("does not abandon queued writes, failed writes or already published output", () => {
    for (const status of ["queued", "failed", "merged", "unchanged"]) {
      expect(canAbandonDocumentWrite({ status, branch: "kintsugi/run" })).toBe(false);
    }
    expect(canAbandonDocumentWrite({ status: "committed" })).toBe(false);
    expect(canAbandonDocumentWrite(undefined)).toBe(false);
  });
});
