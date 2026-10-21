import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "../../src/modules/delivery/member-reviews/application/github-webhook.js";

describe("GitHub webhook signature verification", () => {
  it("matches GitHub's published HMAC-SHA256 test vector", () => {
    expect(
      verifyGitHubWebhookSignature(
        Buffer.from("Hello, World!"),
        "It's a Secret to Everybody",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      ),
    ).toBe(true);
  });

  it("verifies the exact raw JSON bytes rather than a parsed and re-serialized object", () => {
    const raw = Buffer.from('{ "action" : "synchronize", "repository" : {"id": 42} }');
    const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyGitHubWebhookSignature(raw, "secret", signature)).toBe(true);
    expect(verifyGitHubWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(raw.toString("utf8")))), "secret", signature)).toBe(false);
  });

  it.each([undefined, "", "sha1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sha256=xyz", "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00"])(
    "rejects malformed or missing signatures (%s)",
    (signature) => {
      expect(verifyGitHubWebhookSignature(Buffer.from("{}"), "secret", signature)).toBe(false);
    },
  );
});
