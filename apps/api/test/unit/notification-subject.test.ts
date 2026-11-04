import { describe, expect, it } from "vitest";
import { checkSubject, SUBJECT_VALUE_MAX } from "#modules/core/notifications/domain/notification.js";

describe("the subject of a notification holds ids only", () => {
  it("takes the four reference keys", () => {
    expect(checkSubject({ pageKey: "PAGE-ENG-0012", commit: "a".repeat(40), commentId: "c1", actorId: "u1" })).toEqual({ pageKey: "PAGE-ENG-0012", commit: "a".repeat(40), commentId: "c1", actorId: "u1" });
    expect(checkSubject({})).toEqual({});
    expect(checkSubject({ pageKey: "path:a/b.md" })).toEqual({ pageKey: "path:a/b.md" });
  });

  it("refuses any other key, so page text, a title or a path cannot be put into a notification", () => {
    for (const key of ["title", "path", "body", "text", "excerpt", "name"]) expect(() => checkSubject({ pageKey: "PAGE-ENG-0012", [key]: "x" })).toThrow(/holds ids only/);
  });

  it("refuses a value that is not a short non-empty string", () => {
    expect(() => checkSubject({ pageKey: "" })).toThrow(/short non-empty string/);
    expect(() => checkSubject({ pageKey: 12 })).toThrow(/short non-empty string/);
    expect(() => checkSubject({ pageKey: { nested: "x" } })).toThrow(/short non-empty string/);
    expect(() => checkSubject({ commentId: "x".repeat(SUBJECT_VALUE_MAX + 1) })).toThrow(/short non-empty string/);
    expect(checkSubject({ commentId: "x".repeat(SUBJECT_VALUE_MAX) })).toEqual({ commentId: "x".repeat(SUBJECT_VALUE_MAX) });
  });
});
