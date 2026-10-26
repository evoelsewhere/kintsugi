import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GapAnswersService } from "../../src/modules/delivery/documents/application/gap-answers.service.js";
import type { Actor } from "../../src/common/auth/decorators.js";
const spec = '# Calc\n\n## Logic\n\nUnknown rate.\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Rate? | legacy/tax.cbl:4 | blocking |\n';
const actor = { id: "alice", username: "alice" } as Actor;
const answer = { item: "tax/calc", gap: "GAP-M101-0001", commit: "a".repeat(40), answer: "Use 8%.", evidence: "REQ-1 approved by finance", status: "resolved" as const };
const make = () => {
  const documents = {
    context: vi.fn().mockResolvedValue({ project: { applications: [{ id: "web" }] } }),
    resolve: vi.fn().mockImplementation(async (_context, ref) => ({ commit: ref ?? "b".repeat(40) })),
    readText: vi.fn().mockResolvedValue(spec),
  };
  const writes = { proposeCorrection: vi.fn().mockResolvedValue({ id: "correction", status: "queued" }) };
  return { service: new GapAnswersService(documents as never, writes as never), documents, writes };
};

describe("answers update the source specification", () => {
  it("proposes exactly the original specification with a compare-and-set hash, without an answer file", async () => {
    const { service, writes } = make();
    await service.propose("shop", "web", answer, actor);
    const [project, message, files, who] = writes.proposeCorrection.mock.calls[0]!;
    expect(project).toBe("shop");
    expect(who).toBe(actor);
    expect(message).toContain(answer.gap);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "10-applications/web/01-legacy/tax/calc/spec.md", expectedHash: createHash("sha256").update(spec).digest("hex") });
    expect(files[0].content).toContain("Unknown rate.");
    expect(files[0].content).toContain("Use 8%.");
    expect(files[0].content).toContain("| resolved |");
  });

  it("rejects a concurrent document change, an unknown gap and an application outside the project", async () => {
    const { service, documents, writes } = make();
    documents.readText.mockResolvedValueOnce(spec).mockResolvedValueOnce(spec + "Changed by a reviewer.\n");
    await expect(service.propose("shop", "web", answer, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.propose("shop", "web", { ...answer, gap: "GAP-M101-0099" }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.propose("shop", "other", answer, actor)).rejects.toMatchObject({ status: 404 });
    expect(writes.proposeCorrection).not.toHaveBeenCalled();
  });
});
