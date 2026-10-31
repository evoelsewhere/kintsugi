import { describe, expect, it } from "vitest";
import { citationText, formatTokens, linkedNodeIds, searchIntent } from "./brain";

describe("brain helpers", () => {
  it("writes a citation the way an agent cites", () => {
    expect(citationText({ nodeId: "a.md#x", path: "a.md", lineStart: 3, lineEnd: 9, commit: "0123456789abcdef0123" })).toBe("a.md:3-9@0123456789ab");
    expect(citationText({ nodeId: "a.md", path: "a.md", lineStart: 4, lineEnd: 4, commit: "fedcba9876543210" })).toBe("a.md:4@fedcba987654");
  });

  it("shortens token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(12_400)).toBe("12k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });

  it("looks up ids and paths, and searches for words", () => {
    expect(searchIntent("RULE-INV01-0001")).toBe("lookup");
    expect(searchIntent("`COM-LOG-01`")).toBe("lookup");
    expect(searchIntent("01-standards/review-rules.md")).toBe("lookup");
    expect(searchIntent("spec.md#business-rules")).toBe("lookup");
    expect(searchIntent("late fee")).toBe("grep");
    expect(searchIntent("rounding")).toBe("grep");
  });

  it("follows a link to its section first, then its document", () => {
    expect(linkedNodeIds("a/b.md", "x")).toEqual(["a/b.md#x", "a/b.md"]);
    expect(linkedNodeIds("a/b.md", undefined)).toEqual(["a/b.md"]);
  });
});
