import { expect, it } from "vitest";
import { understandResults, type StageSource } from "../../src/modules/delivery/documents/application/stage-results.builders.js";
import { catalogDocuments, understoodUnit } from "../support/documents.js";

it("derives current open-question counts from the original specification after an answer is merged", async () => {
  const files: Record<string, string> = {
    ...catalogDocuments("billing", [{ id: "tax", name: "Tax" }], [{ id: "tax/calc", files: ["legacy/tax.cbl"] }]),
    ...understoodUnit("billing", "tax/calc", { digest: "sha256:calc", commit: "a".repeat(40), openQuestions: 9 }),
  };
  const path = "10-applications/billing/01-legacy/tax/calc/spec.md";
  files[path] = '# Calc\n\n## Gaps and questions\n\n| ID | Kind | Question | Where | Impact | Status | Answer | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| GAP-M101-0001 | ambiguous | Rate? | legacy/tax.cbl:4 | blocking | resolved | Use 8%. | REQ-1 |\n';
  const source: StageSource = {
    files: [], read: async () => null, readPath: async (name) => files[name] ?? null,
    list: async (dir) => Object.entries(files).filter(([name]) => name.startsWith(`${dir}/`) && !name.slice(dir.length + 1).includes("/")).map(([name, text]) => ({ path: name, size: Buffer.byteLength(text) })),
  };
  const closed = await understandResults(source, "10-applications/billing/_generated", "billing", []);
  expect(closed.units[0]?.openQuestions).toBe(0);
  expect(closed.counts["openQuestions"]).toBe(0);
  files[path] = files[path]!.replace("| resolved |", "| open |");
  const reopened = await understandResults(source, "10-applications/billing/_generated", "billing", []);
  expect(reopened.units[0]?.openQuestions).toBe(1);
});
