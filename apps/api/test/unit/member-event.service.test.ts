import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@kintsugi/harness-sdk";
import type { MemberPrincipal } from "../../src/modules/core/auth/index.js";
import { MemberEventService } from "../../src/modules/delivery/agent-context/application/member-event.service.js";
import type { MemberEventPrincipalRevalidator, MemberEventReader } from "../../src/modules/delivery/agent-context/domain/member-event.port.js";
import type { ProjectAccessPort } from "../../src/modules/delivery/agent-context/domain/project-access.ports.js";

const principal: MemberPrincipal = {
  userId: "user-1",
  tokenId: "token-1",
  projectIds: ["shop"],
  credentialKind: "coding-agent-read",
};
const event: TaskEvent = {
  schemaVersion: "1",
  id: "evt_0001",
  projectId: "shop",
  unitId: "web/core/invoice",
  kind: "gate.effective",
  occurredAt: "2026-10-21T00:00:00.000Z",
  metadata: { gateId: "G4" },
};

describe("MemberEventService", () => {
  it("uses Last-Event-ID instead of the query cursor before opening the stream", async () => {
    const resolveCursor = vi.fn(async (_projectId: string, _unitId: string, eventId: string) => eventId === "evt_header" ? "12" : "11");
    const reader = {
      resolveCursor,
      readAfter: vi.fn(async () => []),
    } as unknown as MemberEventReader;
    const access = { requireRead: vi.fn(async () => undefined) } as unknown as ProjectAccessPort;
    const authorization = { revalidate: vi.fn(async () => principal) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(reader, access, authorization);

    const prepared = await service.prepare(principal, {
      projectId: "shop",
      unitId: "web/core/invoice",
      afterEventId: "evt_query",
    }, "evt_header");

    expect(resolveCursor).toHaveBeenCalledWith("shop", "web/core/invoice", "evt_header");
    expect(prepared.sequence).toBe("12");
  });

  it("replays retained task events and emits only matching events up to the requested limit", async () => {
    const reader = {
      resolveCursor: vi.fn(),
      readAfter: vi.fn(async () => [{ event, sequence: "5" }]),
    } as unknown as MemberEventReader;
    const access = { requireRead: vi.fn(async () => undefined) } as unknown as ProjectAccessPort;
    const authorization = { revalidate: vi.fn(async () => principal) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(reader, access, authorization);
    const prepared = await service.prepare(principal, { projectId: "shop", unitId: "web/core/invoice", limit: 1 });
    const received: TaskEvent[] = [];
    for await (const item of service.follow(prepared, "knt_pat_secret", new AbortController().signal)) received.push(item);

    expect(received).toEqual([event]);
    expect(authorization.revalidate).toHaveBeenCalledWith(principal, "shop", "knt_pat_secret");
    expect(reader.readAfter).toHaveBeenCalledWith("shop", "web/core/invoice", "0", 1);
  });

  it("does not read events after the member token or project access is revoked", async () => {
    const reader = {
      resolveCursor: vi.fn(),
      readAfter: vi.fn(async () => [{ event, sequence: "5" }]),
    } as unknown as MemberEventReader;
    const requireRead = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("revoked"));
    const access = { requireRead } as unknown as ProjectAccessPort;
    const authorization = { revalidate: vi.fn(async () => principal) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(reader, access, authorization);
    const prepared = await service.prepare(principal, { projectId: "shop", unitId: "web/core/invoice", limit: 1 });

    await expect(async () => {
      for await (const _item of service.follow(prepared, "knt_pat_secret", new AbortController().signal)) { /* consume */ }
    }).rejects.toThrow("revoked");
    expect(reader.readAfter).not.toHaveBeenCalled();
  });

  it("rejects a missing or out-of-scope replay cursor before opening the stream", async () => {
    const reader = {
      resolveCursor: vi.fn(async () => undefined),
      readAfter: vi.fn(async () => []),
    } as unknown as MemberEventReader;
    const access = { requireRead: vi.fn(async () => undefined) } as unknown as ProjectAccessPort;
    const authorization = { revalidate: vi.fn(async () => undefined) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(reader, access, authorization);

    await expect(service.prepare(principal, { projectId: "shop", unitId: "web/core/invoice", afterEventId: "evt_old" }))
      .rejects.toMatchObject({ response: { details: { code: "MEMBER_EVENT_CURSOR_EXPIRED" } } });
    expect(reader.readAfter).not.toHaveBeenCalled();
  });

  it("compares monotonic cursors numerically and stops on a corrupt or repeated event", async () => {
    const reader = {
      resolveCursor: vi.fn(),
      readAfter: vi.fn(async () => [{ event, sequence: "10" }, { event: { ...event, id: "evt_0002" }, sequence: "9" }]),
    } as unknown as MemberEventReader;
    const access = { requireRead: vi.fn(async () => undefined) } as unknown as ProjectAccessPort;
    const authorization = { revalidate: vi.fn(async () => undefined) } as unknown as MemberEventPrincipalRevalidator;
    const service = new MemberEventService(reader, access, authorization);
    const prepared = await service.prepare(principal, { projectId: "shop", unitId: "web/core/invoice", limit: 2 });
    expect(prepared.sequence).toBe("0");
    const received: TaskEvent[] = [];

    await expect(async () => {
      for await (const item of service.follow(prepared, "knt_pat_secret", new AbortController().signal)) received.push(item);
    }).rejects.toThrow("stored task event does not match its stream cursor");
    expect(received).toEqual([event]);
  });
});
