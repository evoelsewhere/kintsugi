import { boundSnapshotSections, buildSnapshotManifest, indexMarkdownSections } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
import { describe, expect, it } from "vitest";

const sha = (character: string): string => character.repeat(40);
const hash = (character: string): string => "sha256:" + character.repeat(64);

const input = {
  snapshotId: "ctx_001",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  activity: "implementation" as const,
  repositories: [{ repositoryId: "project-docs", commit: sha("a") }],
  sources: [{
    sourceId: "src_tax_design",
    role: "detailed-design",
    repositoryId: "project-docs",
    path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md",
    commit: sha("a"),
    contentHash: hash("b"),
    availability: "present" as const,
    publication: "published" as const,
    approval: "approved" as const,
    requiredFor: ["implementation"] as const,
    required: true,
    readable: true,
    sections: [],
  }],
  task: {
    sourceId: "src_unit",
    role: "work-item",
    repositoryId: "project-docs",
    path: "10-applications/billing/02-modern/invoices/tax/README.md",
    commit: sha("a"),
    contentHash: hash("c"),
  },
  requiredDeliverableIds: ["code", "design"],
  policyRevision: "coding-agent-context-v1",
  createdAt: "2026-10-20T07:00:00.000Z",
  expiresAt: "2026-10-21T07:00:00.000Z",
};

describe("immutable task context manifest", () => {
  it("bounds ordinary heading titles without losing their source text or identity", () => {
    const title = "x".repeat(501);
    const sections = indexMarkdownSections("src_long_heading", "# " + title + "\nDetails.", true);
    expect(sections[0]?.title).toBe(title.slice(0, 500));
    expect(sections[0]?.endLine).toBe(2);
    expect(sections[0]?.byteLength).toBe(Buffer.byteLength("# " + title + "\nDetails."));
  });

  it("hashes relevant inputs while keeping generated commits and observation times out of context revision", () => {
    const first = buildSnapshotManifest(input);
    const generatedOnlyInput = {
      ...input,
      snapshotId: "ctx_002",
      repositories: [{ repositoryId: "project-docs", commit: sha("d") }],
      sources: input.sources.map((source) => ({ ...source, commit: sha("d") })),
      task: { ...input.task, commit: sha("d") },
      createdAt: "2026-10-20T08:00:00.000Z",
      expiresAt: "2026-10-21T08:00:00.000Z",
    };
    const generatedOnly = buildSnapshotManifest(generatedOnlyInput);
    const relevantInputChanged = buildSnapshotManifest({
      ...input,
      sources: input.sources.map((source) => ({ ...source, contentHash: hash("e") })),
    });

    expect(first.repositories[0]?.commit).toBe(sha("a"));
    expect(generatedOnly.repositories[0]?.commit).toBe(sha("d"));
    expect(generatedOnly.contextRevision).toBe(first.contextRevision);
    expect(relevantInputChanged.contextRevision).not.toBe(first.contextRevision);
  });

  it("bounds dense section indexes while preserving the complete source tail", () => {
    const markdown = Array.from({ length: 501 }, (_, index) =>
      "## Requirement " + (index + 1) + "\nDetail " + (index + 1),
    ).join("\n");
    const indexed = indexMarkdownSections("src_dense", markdown, true);
    expect(indexed).toHaveLength(400);
    expect(indexed.at(-1)?.startLine).toBe(799);
    expect(indexed.at(-1)?.endLine).toBe(1002);

    const source = input.sources[0]!;
    const crowded = {
      ...source,
      sections: Array.from({ length: 500 }, (_, index) => ({
        sectionId: "sec_" + index,
        title: "Requirement " + index,
        startLine: index * 2 + 1,
        endLine: index * 2 + 2,
        byteLength: 16,
        required: true,
      })),
    };
    const other = { ...source, sourceId: "src_other", sections: [source.sections[0] ?? {
      sectionId: "sec_other",
      title: "Other",
      startLine: 1,
      endLine: 1,
      byteLength: 5,
      required: true,
    }] };
    const bounded = boundSnapshotSections([crowded, other]);
    expect(bounded.reduce((total, item) => total + item.sections.length, 0)).toBe(400);
    expect(bounded[1]?.sections).toHaveLength(1);
    expect(bounded[0]?.sections.at(-1)?.endLine).toBe(1000);
  });

  it("indexes deterministic Markdown sections with source line ranges", () => {
    const markdown = "# Objective\r\nCalculate tax.\r\n\r\n## Rounding\r\nRound once.\r\n";
    const first = indexMarkdownSections("src_tax_design", markdown, true);
    const edited = indexMarkdownSections("src_tax_design", markdown.replace("Calculate tax.", "Calculate tax exactly."), true);

    expect(first.map(({ title, startLine, endLine }) => ({ title, startLine, endLine }))).toEqual([
      { title: "Objective", startLine: 1, endLine: 3 },
      { title: "Rounding", startLine: 4, endLine: 6 },
    ]);
    expect(edited.map((section) => section.sectionId)).toEqual(first.map((section) => section.sectionId));
    expect(first.every((section) => section.required)).toBe(true);
  });
});
