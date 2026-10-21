import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { githubRepositoryPathFromRemote } from "@kintsugi/git";
import { GitRegistry, type GitRepositoryRecord } from "#modules/admin/git/index.js";
import { ProviderDeliveryConflictError, ProviderDeliveryRepository, type ProviderDeliveryInput } from "../domain/provider-delivery.js";

export const MAX_GITHUB_WEBHOOK_BYTES = 1024 * 1024;
const deliveryIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supportedEvents = new Set(["pull_request", "pull_request_review", "check_run", "check_suite"]);

type AcceptResult =
  | { accepted: true; duplicate: boolean }
  | { accepted: false; reason: "event-unmapped" | "repository-unmapped" };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function providerId(value: unknown): string | undefined {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isSafeInteger(value))) return undefined;
  const normalized = String(value);
  return /^\d{1,200}$/.test(normalized) ? normalized : undefined;
}

function repositoryPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")) return undefined;
  return value;
}

function pullRequestNumber(value: unknown): number | undefined {
  const raw = record(value)["number"];
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
}

function providerPullRequestId(value: unknown): string | undefined {
  return providerId(record(value)["id"]);
}

/** Verifies GitHub's X-Hub-Signature-256 against the request's original bytes. */
export function verifyGitHubWebhookSignature(rawBody: Uint8Array, secret: string, signature: string | undefined): boolean {
  if (secret.length === 0 || signature === undefined || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

@Injectable()
export class GitHubWebhookService {
  constructor(private readonly git: GitRegistry, private readonly inbox: ProviderDeliveryRepository) {}

  async accept(input: {
    serverId: string;
    deliveryId: string | undefined;
    eventName: string | undefined;
    signature: string | undefined;
    rawBody: Buffer;
  }): Promise<AcceptResult> {
    if (input.rawBody.byteLength > MAX_GITHUB_WEBHOOK_BYTES) throw new BadRequestException("GitHub webhook payload exceeds 1 MiB");
    const server = await this.git.getServer(input.serverId);
    if (server === undefined || (server.kind !== "github" && server.kind !== "github-enterprise")) {
      throw new NotFoundException("GitHub webhook endpoint is not configured");
    }
    const serverKind = server.kind;
    const secret = await this.git.githubWebhookSecret(input.serverId);
    if (secret === undefined) throw new NotFoundException("GitHub webhook endpoint is not configured");
    if (!verifyGitHubWebhookSignature(input.rawBody, secret, input.signature)) {
      throw new UnauthorizedException("Invalid GitHub webhook signature");
    }

    if (input.deliveryId === undefined || !deliveryIdPattern.test(input.deliveryId)) {
      throw new BadRequestException("X-GitHub-Delivery must be a GUID");
    }
    if (input.eventName === undefined || input.eventName.length === 0 || input.eventName.length > 100) {
      throw new BadRequestException("X-GitHub-Event is missing or invalid");
    }
    if (!supportedEvents.has(input.eventName)) return { accepted: false, reason: "event-unmapped" };
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new BadRequestException("GitHub webhook payload is not valid JSON");
    }
    const payload = record(body);
    const repository = record(payload["repository"]);
    const providerRepositoryId = providerId(repository["id"]);
    const path = repositoryPath(repository["full_name"]);
    if (providerRepositoryId === undefined || path === undefined) {
      throw new BadRequestException("GitHub webhook payload has no valid repository identity");
    }
    const repositories = await this.git.listRepositories();
    const matches = repositories.filter((candidate) => this.#matchesRepository(candidate, serverKind, server.baseUrl, input.serverId, path));
    if (matches.length !== 1) return { accepted: false, reason: "repository-unmapped" };

    const number = pullRequestNumber(payload["pull_request"]);
    const pullRequestId = providerPullRequestId(payload["pull_request"]);
    const action = payload["action"];
    const delivery: ProviderDeliveryInput = {
      serverId: input.serverId,
      repositoryId: matches[0]!.id,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      ...(typeof action === "string" && action.length <= 100 ? { action } : {}),
      ...(number === undefined ? {} : { pullRequestNumber: number }),
      payload: {
        providerRepositoryId,
        repositoryPath: path,
        ...(pullRequestId === undefined ? {} : { providerPullRequestId: pullRequestId }),
        ...(number === undefined ? {} : { pullRequestNumber: number }),
      },
      payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
    };
    try {
      const persistence = await this.inbox.persist(delivery);
      return { accepted: true, duplicate: persistence === "duplicate" };
    } catch (error) {
      if (error instanceof ProviderDeliveryConflictError) throw new ConflictException("GitHub reused a delivery id with different payload bytes");
      throw error;
    }
  }

  #matchesRepository(candidate: GitRepositoryRecord, kind: "github" | "github-enterprise", baseUrl: string, serverId: string, path: string): boolean {
    if (candidate.serverId !== serverId) return false;
    try {
      return githubRepositoryPathFromRemote(candidate.url, kind, baseUrl).toLowerCase() === path.toLowerCase();
    } catch {
      return false;
    }
  }
}
