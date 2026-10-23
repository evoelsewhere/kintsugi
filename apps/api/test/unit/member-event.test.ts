import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { MemberEventService } from "../../src/modules/delivery/agent-context/application/member-event.service.js";
import type { MemberEventReader, MemberEventPrincipalRevalidator } from "../../src/modules/delivery/agent-context/domain/member-event.port.js";
import type { ProjectAccessPort } from "../../src/modules/delivery/agent-context/domain/project-access.ports.js";
import { describe, expect, it, vi } from "vitest";

const principal: MemberPrincipal = {
  userId: "user-alice",
  tokenId: "token-1",
  projectIds: ["project-a"],
  credentialKind: "coding-agent-read",
};

describe("MemberEventService", () => {
  it("replays retained events on a first connection so a reconnect before first delivery cannot skip them", async () => {
    const eventReader = {
      latestContinuation: vi.fn(),
      latestSequence: vi.fn(async () => "41"),
      resolveCursor: vi.fn(),
      readAfter: vi.fn(),
    };
    const projectAccess = { requireRead: vi.fn(async () => undefined) } as unknown as ProjectAccessPort;
    const revalidator = { revalidate: vi.fn(async () => undefined) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(eventReader as unknown as MemberEventReader, projectAccess, revalidator);

    const prepared = await service.prepare(principal, { projectId: "project-a", unitId: "billing/invoices/tax" });

    expect(prepared.sequence).toBe("0");
    expect(eventReader.latestSequence).not.toHaveBeenCalled();
  });
});
