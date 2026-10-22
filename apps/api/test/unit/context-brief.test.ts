import type { SnapshotSource } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import { selectBriefSections } from "../../src/modules/delivery/agent-context/application/brief-sections.js";
import { describe, expect, it, vi } from "vitest";

const source: SnapshotSource = {
  sourceId: "src_large_design",
  role: "detailed-design",
  repositoryId: "project-docs",
  path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md",
  commit: "a".repeat(40),
  contentHash: "sha256:" + "b".repeat(64),
  availability: "present",
  publication: "published",
  approval: "approved",
  requiredFor: ["implementation"],
  required: true,
  readable: true,
  sections: [{
    sectionId: "sec_rounding",
    title: "Rounding boundaries",
    startLine: 1,
    endLine: 2,
    byteLength: 33 * 1024,
    required: true,
  }],
};

describe("brief section budget", () => {
  it("marks an oversized mandatory section partial and returns its exact continuation identity", () => {
    const selected = selectBriefSections([source], new Map([[source.sourceId, "# Rounding boundaries\n" + "x".repeat(33 * 1024)]]), 32 * 1024);

    expect(selected.requiredContextStatus).toBe("partial");
    expect(selected.sections).toEqual([]);
    expect(selected.omittedSections).toEqual([
      { sourceId: source.sourceId, sectionId: "sec_rounding", required: true },
    ]);
  });

  it("splits each source once when selecting multiple sections", () => {
    const multiSectionSource: SnapshotSource = {
      ...source,
      sections: [
        { sectionId: "sec_one", title: "One", startLine: 1, endLine: 2, byteLength: 7, required: true },
        { sectionId: "sec_two", title: "Two", startLine: 3, endLine: 4, byteLength: 7, required: true },
      ],
    };
    const split = vi.spyOn(String.prototype, "split");
    try {
      const selected = selectBriefSections(
        [multiSectionSource],
        new Map([[source.sourceId, "# One\nA\n# Two\nB"]]),
        1024,
      );
      const lineSplits = split.mock.calls.filter(([separator]) => separator instanceof RegExp && separator.source === "\\r\\n|\\n|\\r");

      expect(selected.sections).toHaveLength(2);
      expect(lineSplits).toHaveLength(1);
    } finally {
      split.mockRestore();
    }
  });

  it("does not make optional omitted sections block required context", () => {
    const optional = { ...source, required: false, sections: source.sections.map((section) => ({ ...section, required: false })) };
    const selected = selectBriefSections([optional], new Map([[source.sourceId, "x".repeat(33 * 1024)]]), 32 * 1024);

    expect(selected.requiredContextStatus).toBe("complete");
    expect(selected.omittedSections).toEqual([]);
  });

  it("reports a missing mandatory source even when there are no sections to page", () => {
    const missing = { ...source, sourceId: "src_missing", availability: "missing" as const, commit: undefined, contentHash: undefined, sections: [] };
    const selected = selectBriefSections([missing], new Map(), 32 * 1024);

    expect(selected.requiredContextStatus).toBe("partial");
    expect(selected.omittedSections).toEqual([
      { sourceId: "src_missing", sectionId: "unavailable", required: true },
    ]);
  });
});
