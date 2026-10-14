// What a failed git call tells the user: the remote's reason, not only git's generic last line.

import { describe, expect, it } from "vitest";
import { failureSummary } from "../src/cli.js";

describe("failureSummary", () => {
  it("keeps the remote's reply and the rejected ref of a refused push", () => {
    const stderr = [
      "remote: error: token does not have the write:repository scope",
      "To http://localhost:3300/org/docs",
      " ! [remote rejected] HEAD -> refs/heads/kintsugi/x (pre-receive hook declined)",
      "error: failed to push some refs to 'http://localhost:3300/org/docs'",
      "hint: Updates were rejected",
    ].join("\n");
    expect(failureSummary(stderr)).toBe(
      "remote: error: token does not have the write:repository scope | ! [remote rejected] HEAD -> refs/heads/kintsugi/x (pre-receive hook declined) | error: failed to push some refs to 'http://localhost:3300/org/docs'",
    );
  });

  it("falls back to the last line and caps the length", () => {
    expect(failureSummary("something odd\nthe last line\n")).toBe("the last line");
    expect(failureSummary(`fatal: ${"x".repeat(900)}`).length).toBeLessThanOrEqual(601);
    expect(failureSummary("")).toBe("");
  });
});
