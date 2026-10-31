import { describe, expect, it } from "vitest";
import { localizeInstants } from "./format";

describe("localizeInstants", () => {
  it("says a UTC instant in a sentence relative to now", () => {
    const now = Date.parse("2026-10-31T19:04:40Z");
    expect(localizeInstants("No worker is running · Last seen 2026-10-31T19:03:37.949Z on LPP00299100N", now)).toBe("No worker is running · Last seen 1 minute ago on LPP00299100N");
    expect(localizeInstants("Nothing timed here", now)).toBe("Nothing timed here");
  });
});
