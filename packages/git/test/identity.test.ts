// The commit identity admins set in the portal (ADR-0019): checked before Git ever sees it.

import { describe, expect, it } from "vitest";
import { DEFAULT_COMMIT_IDENTITY, commitIdentityProblems } from "../src/index.js";

describe("commit identity", () => {
  it("accepts the default and plain identities", () => {
    expect(commitIdentityProblems(DEFAULT_COMMIT_IDENTITY)).toEqual([]);
    expect(commitIdentityProblems({ name: "Modernization Bot", email: "modernization-bot@example.com" })).toEqual([]);
  });

  it("refuses names and emails Git or a commit header would misread", () => {
    expect(commitIdentityProblems({ name: " ", email: "bot@example.com" })).toEqual(["name is empty"]);
    expect(commitIdentityProblems({ name: "Bot <x>", email: "bot@example.com" })).toHaveLength(1);
    expect(commitIdentityProblems({ name: "Bot\nInjected: yes", email: "bot@example.com" })).toHaveLength(1);
    expect(commitIdentityProblems({ name: "Bot", email: "Bot <bot@example.com>" })).toHaveLength(1);
    expect(commitIdentityProblems({ name: "Bot", email: "not-an-email" })).toHaveLength(1);
  });
});
