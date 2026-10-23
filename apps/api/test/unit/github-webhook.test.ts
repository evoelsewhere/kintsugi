import { createHmac } from "node:crypto";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { GitRegistry } from "../../src/modules/admin/git/domain/git.ports.js";
import type { GitRepositoryRecord, GitServerRecord } from "../../src/modules/admin/git/domain/git.js";
import type { ProviderDeliveryRepository } from "../../src/modules/delivery/member-reviews/domain/provider-delivery.js";
import { GitHubWebhookService } from "../../src/modules/delivery/member-reviews/application/github-webhook.js";
import { describe, expect, it, vi } from "vitest";

const SECRET = "TEST-webhook-secret";
const SERVER: GitServerRecord = {
  id: "github",
  kind: "github",
  name: "GitHub",
  baseUrl: "https://github.com",
  authType: "none",
  hasCredential: false,
  hasGithubWebhookSecret: true,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};
const REPOSITORY = {
  id: "billing",
  serverId: "github",
  url: "https://github.com/Acme/Billing.git",
  syncStatus: "ready",
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
} as GitRepositoryRecord;

function delivery(body: Buffer, overrides: Partial<{ serverId: string; deliveryId: string; eventName: string; signature: string }> = {}) {
  return {
    serverId: "github",
    deliveryId: "0b989ba4-242f-11e5-81e1-c7b6966d2516",
    eventName: "pull_request",
    signature: `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
    rawBody: body,
    ...overrides,
  };
}

function service(options: { secret?: string | null; repositories?: GitRepositoryRecord[]; persistResult?: "accepted" | "duplicate" } = {}) {
  const secret = options.secret === undefined ? SECRET : options.secret ?? undefined;
  const git = {
    getServer: vi.fn(async () => SERVER),
    githubWebhookSecret: vi.fn(async () => secret),
    listRepositories: vi.fn(async () => options.repositories ?? [REPOSITORY]),
  } as unknown as GitRegistry;
  const inbox = { persist: vi.fn(async () => options.persistResult ?? "accepted") };
  return { webhooks: new GitHubWebhookService(git, inbox as unknown as ProviderDeliveryRepository), git, inbox };
}

const payload = () => Buffer.from(JSON.stringify({
  action: "synchronize",
  repository: { id: 42, full_name: "Acme/Billing", name: "Billing" },
  pull_request: { id: 87, number: 12, body: "Untrusted PR text is not persisted." },
}));

describe("GitHub webhook inbox acceptance", () => {
  it("verifies the HMAC before parsing or persisting a delivery", async () => {
    const { webhooks, inbox } = service();
    await expect(webhooks.accept(delivery(Buffer.from("not-json"), { signature: "sha256=" + "0".repeat(64) }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(inbox.persist).not.toHaveBeenCalled();
  });

  it("persists only an allowlisted hint after binding the provider repository to one registered Git repository", async () => {
    const body = payload();
    const { webhooks, inbox } = service();
    await expect(webhooks.accept(delivery(body))).resolves.toEqual({ accepted: true, duplicate: false });
    expect(inbox.persist).toHaveBeenCalledWith(expect.objectContaining({
      serverId: "github",
      repositoryId: "billing",
      deliveryId: "0b989ba4-242f-11e5-81e1-c7b6966d2516",
      eventName: "pull_request",
      action: "synchronize",
      pullRequestNumber: 12,
      payloadSha256: expect.any(String),
      payload: {
        providerRepositoryId: "42",
        repositoryPath: "Acme/Billing",
        providerPullRequestId: "87",
        pullRequestNumber: 12,
      },
    }));
    expect(JSON.stringify(inbox.persist.mock.calls)).not.toContain("Untrusted PR text");
  });

  it("returns an idempotent acknowledgment for a duplicate delivery", async () => {
    const { webhooks, inbox } = service({ persistResult: "duplicate" });
    await expect(webhooks.accept(delivery(payload()))).resolves.toEqual({ accepted: true, duplicate: true });
    expect(inbox.persist).toHaveBeenCalledTimes(1);
  });

  it("acknowledges an unmapped repository without creating a local observation or receipt", async () => {
    const { webhooks, inbox } = service({ repositories: [] });
    await expect(webhooks.accept(delivery(payload()))).resolves.toEqual({ accepted: false, reason: "repository-unmapped" });
    expect(inbox.persist).not.toHaveBeenCalled();
  });

  it("acknowledges unsupported signed event kinds without requiring event-specific JSON shape", async () => {
    const { webhooks, inbox } = service();
    const rawBody = Buffer.from("{}");
    await expect(webhooks.accept(delivery(rawBody, { eventName: "issues" }))).resolves.toEqual({ accepted: false, reason: "event-unmapped" });
    expect(inbox.persist).not.toHaveBeenCalled();
  });

  it("leaves polling available when no webhook secret is configured", async () => {
    const { webhooks, inbox } = service({ secret: null });
    await expect(webhooks.accept(delivery(payload()))).rejects.toBeInstanceOf(NotFoundException);
    expect(inbox.persist).not.toHaveBeenCalled();
  });
});
