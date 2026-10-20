import { buildSnapshotManifest, indexMarkdownSections } from "../../src/modules/delivery/agent-context/domain/snapshot.js";
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
    path: "applications/billing/units/invoices/tax/design.md",
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
    path: "applications/billing/units/invoices/tax/unit.md",
    commit: sha("a"),
    contentHash: hash("c"),
  },
  requiredDeliverableIds: ["code", "design"],
  policyRevision: "coding-agent-context-v1",
  createdAt: "2026-10-20T07:00:00.000Z",
  expiresAt: "2026-10-21T07:00:00.000Z",
};

describe("immutable task context manifest", () => {
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
