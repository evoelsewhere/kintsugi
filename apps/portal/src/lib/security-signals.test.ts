import { describe, expect, it } from "vitest";
import { coverageSignal, injectionSignal } from "./security-signals";

describe("security signals", () => {
  it("says coverage is complete only when the document says so, and names gaps as a problem", () => {
    expect(coverageSignal({ coverageComplete: true, coverageGaps: [] })).toBe("complete");
    expect(coverageSignal({ coverageComplete: false, coverageGaps: ["sast-taint did not return"] })).toBe("gaps");
  });

  it("does not take a missing coverage section for complete coverage", () => {
    expect(coverageSignal({ coverageComplete: false, coverageGaps: [] })).toBe("unknown");
  });

  it("tells a reported clean injection check from flags and from no report at all", () => {
    expect(injectionSignal({ injectionFlags: "None found in the scanned files." })).toBe("none");
    expect(injectionSignal({ injectionFlags: "src/a.cbl:12 asks the reader to ignore its instructions" })).toBe("found");
    expect(injectionSignal({})).toBe("unknown");
    expect(injectionSignal({ injectionFlags: " " })).toBe("unknown");
  });
});
