import { describe, expect, it } from "vitest";
import { EMPTY_REPOSITORY_MESSAGE, describeSyncError } from "../src/repository-sync.js";

describe("describeSyncError", () => {
  it("says a repository with no commit is empty instead of showing git's message", () => {
    expect(describeSyncError("git rev-parse --verify HEAD^{commit} failed (exit 128): fatal: Needed a single revision")).toBe(EMPTY_REPOSITORY_MESSAGE);
    expect(describeSyncError("git rev-parse --verify --end-of-options HEAD^{commit} failed (exit 128): fatal: Needed a single revision")).toBe(EMPTY_REPOSITORY_MESSAGE);
  });

  it("names the branch when a followed branch has no commit", () => {
    expect(describeSyncError("git rev-parse --verify refs/heads/main^{commit} failed (exit 128): fatal: Needed a single revision")).toBe(
      "The branch main has no commit in the repository (it is empty or the branch does not exist)",
    );
  });

  it("keeps every other message", () => {
    expect(describeSyncError("git fetch failed (exit 128): fatal: Authentication failed")).toBe("git fetch failed (exit 128): fatal: Authentication failed");
    expect(describeSyncError(EMPTY_REPOSITORY_MESSAGE)).toBe(EMPTY_REPOSITORY_MESSAGE);
  });
});
