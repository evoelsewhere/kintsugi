/** A provider delivery is a durable, untrusted change hint. It is never review evidence. */
export interface ProviderDeliveryHint {
  providerRepositoryId: string;
  repositoryPath: string;
  providerPullRequestId?: string;
  pullRequestNumber?: number;
}

export interface ProviderDeliveryInput {
  serverId: string;
  repositoryId: string;
  deliveryId: string;
  eventName: string;
  action?: string;
  pullRequestNumber?: number;
  payload: ProviderDeliveryHint;
  payloadSha256: string;
}

export type ProviderDeliveryPersistence = "accepted" | "duplicate";

export class ProviderDeliveryConflictError extends Error {
  constructor() {
    super("provider reused a delivery id with a different payload");
    this.name = "ProviderDeliveryConflictError";
  }
}

export abstract class ProviderDeliveryRepository {
  abstract persist(input: ProviderDeliveryInput): Promise<ProviderDeliveryPersistence>;
}
