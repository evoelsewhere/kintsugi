import { Injectable } from "@nestjs/common";
import { withTransaction } from "#common/db/pool.js";
import { ProviderDeliveryConflictError, ProviderDeliveryRepository, type ProviderDeliveryInput } from "../domain/provider-delivery.js";

@Injectable()
export class PgProviderDeliveryRepository extends ProviderDeliveryRepository {
  async persist(input: ProviderDeliveryInput): Promise<"accepted" | "duplicate"> {
    return withTransaction(async (client) => {
      const inserted = await client.query<{ delivery_id: string }>(
        `insert into workflow.member_provider_delivery
           (server_id, delivery_id, event_name, action, repository_id, pull_request_number, payload, payload_sha256)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing
         returning delivery_id`,
        [input.serverId, input.deliveryId, input.eventName, input.action ?? null, input.repositoryId, input.pullRequestNumber ?? null, JSON.stringify(input.payload), input.payloadSha256],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `update workflow.member_provider_sync_watermark
              set next_poll_at = least(next_poll_at, clock_timestamp()), updated_at = clock_timestamp()
            where repository_id = $1 and last_error is null`,
          [input.repositoryId],
        );
        return "accepted";
      }

      const existing = await client.query<{ payload_sha256: string }>(
        "select payload_sha256 from workflow.member_provider_delivery where server_id = $1 and delivery_id = $2",
        [input.serverId, input.deliveryId],
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].payload_sha256 === input.payloadSha256) return "duplicate";
        throw new ProviderDeliveryConflictError();
      }
      const replay = await client.query(
        "select 1 from workflow.member_provider_delivery where server_id = $1 and payload_sha256 = $2",
        [input.serverId, input.payloadSha256],
      );
      if (replay.rowCount === 1) return "duplicate";
      throw new Error("provider delivery insert conflicted without a matching receipt");
    });
  }
}
