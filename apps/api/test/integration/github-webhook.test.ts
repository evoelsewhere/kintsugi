import { createHash, createHmac } from "node:crypto";
import { encryptSecret } from "@kintsugi/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { startTestApp, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("GitHub webhook ingress (integration)", () => {
  let app: TestApp;
  const secret = "TEST-webhook-signing-secret-0123456789";
  const path = "/webhooks/github/webhook-test";

  beforeAll(async () => {
    app = await startTestApp();
    await app.db.query(
      "insert into admin.git_server (id, kind, name, base_url, auth_type) values ('webhook-test', 'github', 'Webhook test', 'https://github.com', 'none')",
    );
    await app.db.query(
      "insert into admin.git_repository (id, server_id, url) values ('webhook-repo', 'webhook-test', 'https://github.com/Acme/Webhook-repo.git')",
    );
    const encrypted = encryptSecret(secret);
    await app.db.query(
      `insert into admin.git_secret (secret_id, server_id, ciphertext, iv, auth_tag)
       values ('git-server:webhook-test:github-webhook-secret', 'webhook-test', $1, $2, $3)`,
      [encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );
  });

  afterAll(async () => app?.close());

  it("authenticates original bytes without a session or CSRF token and durably deduplicates delivery ids", async () => {
    const rawBody = Buffer.from('{ "action": "closed", "repository": { "id": 42, "full_name": "Acme/Webhook-repo" }, "pull_request": { "id": 987, "number": 7 } }');
    const sign = (body: Buffer) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const send = (deliveryId: string, body: Buffer, signature = sign(body)) => fetch(`${app.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature,
      },
      body: body.toString("utf8"),
    });

    const invalid = await send("10101010-1010-4010-8010-101010101010", rawBody, "sha256=" + "0".repeat(64));
    expect(invalid.status).toBe(401);
    expect((await app.db.query("select delivery_id from workflow.member_provider_delivery")).rows).toHaveLength(0);

    const compressed = await fetch(`${app.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "x-github-delivery": "40404040-4040-4040-8040-404040404040",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(rawBody),
      },
      body: rawBody.toString("utf8"),
    });
    expect(compressed.status).toBe(415);

    const oversized = await fetch(`${app.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);

    const id = "20202020-2020-4020-8020-202020202020";
    const accepted = await send(id, rawBody);
    expect(accepted.status).toBe(202);
    expect((await accepted.json()).data).toEqual({ accepted: true, duplicate: false });

    const duplicate = await send(id, rawBody);
    expect(duplicate.status).toBe(202);
    expect((await duplicate.json()).data).toEqual({ accepted: true, duplicate: true });

    const replay = await send("30303030-3030-4030-8030-303030303030", rawBody);
    expect(replay.status).toBe(202);
    expect((await replay.json()).data).toEqual({ accepted: true, duplicate: true });

    const changedBody = Buffer.from(rawBody.toString("utf8").replace('"closed"', '"opened"'));
    const conflict = await send(id, changedBody);
    expect(conflict.status).toBe(409);

    const stored = await app.db.query<{ payload: Record<string, unknown>; payload_sha256: string; state: string }>(
      "select payload, payload_sha256, state from workflow.member_provider_delivery where delivery_id = $1",
      [id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      state: "pending",
      payload: {
        providerRepositoryId: "42",
        repositoryPath: "Acme/Webhook-repo",
        providerPullRequestId: "987",
        pullRequestNumber: 7,
      },
    });
    expect(stored.rows[0]?.payload_sha256).toBe(createHash("sha256").update(rawBody).digest("hex"));
  });
});
