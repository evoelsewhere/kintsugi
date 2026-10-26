import { expect, it, vi } from "vitest";
import { BuildService } from "../../src/modules/delivery/build/application/build.service.js";

it("never attributes a build record to another application with the same unit key", async () => {
  const record = (application?: string) => ({ kind: "build.mr", summary: "tax/calc", at: "2026-10-26T10:00:00Z", username: "alice", detail: { mr: `https://git.example/${application ?? "legacy"}/7`, commit: "a".repeat(40), ...(application === undefined ? {} : { application }) } });
  const activity = { list: vi.fn().mockResolvedValue({ items: [record("other"), record(), record("web")] }) };
  const service = new BuildService({} as never, {} as never, {} as never, {} as never, activity as never);
  const scoped = await service.memberBuilds("shop", false, { applicationId: "web", allowLegacy: false });
  expect(scoped.get("tax/calc")?.mr).toBe("https://git.example/web/7");
  const single = await service.memberBuilds("shop", false, { applicationId: "web", allowLegacy: true });
  expect(single.get("tax/calc")?.mr).toBe("https://git.example/legacy/7");
});
