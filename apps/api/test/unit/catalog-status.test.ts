// The derived status of a catalog item (ADR-0033) and why an understood one is stale: its files changed, or the
// specification profile of its kind was raised since the specification was written (ADR-0060).

import { builtinSpecProfileVersions, profileVersionOf } from "@kintsugi/agents";
import type { ItemCatalogItem } from "@kintsugi/agents/reader";
import { describe, expect, it } from "vitest";
import { deriveItemStatus } from "#modules/delivery/catalog/domain/catalog.js";

const item = (over: Partial<ItemCatalogItem> = {}): ItemCatalogItem =>
  ({ id: "ui/order", module: "ui", kind: "screen", name: "Order", summary: "", files: ["src/Order.vue"], leaves: [], entryPoints: [], loc: 100, complexity: "low", digest: "sha256:a", status: "active", aliases: [], parts: [], ...over }) as ItemCatalogItem;

describe("deriveItemStatus: stale", () => {
  const profiles = new Map([["screen", 2]]);

  it("is understood while the digest and the profile are current", () => {
    expect(deriveItemStatus(item(), { digest: "sha256:a", profile: { kind: "screen", version: 2 } }, [], profiles)).toMatchObject({ status: "understood" });
  });

  it("is stale for its source when the digest moved, whatever the profile", () => {
    expect(deriveItemStatus(item(), { digest: "sha256:old", profile: { kind: "screen", version: 2 } }, [], profiles)).toMatchObject({ status: "stale", staleReason: "source" });
  });

  it("is stale for its profile when the kind's profile was raised, or the item changed kind", () => {
    expect(deriveItemStatus(item(), { digest: "sha256:a", profile: { kind: "screen", version: 1 } }, [], profiles)).toMatchObject({ status: "stale", staleReason: "profile" });
    expect(deriveItemStatus(item(), { digest: "sha256:a", profile: { kind: "module", version: 1 } }, [], profiles)).toMatchObject({ status: "stale", staleReason: "profile" });
  });

  it("is not stale for a profile when none was recorded or the kind has no profile", () => {
    expect(deriveItemStatus(item(), { digest: "sha256:a" }, [], profiles).status).toBe("understood");
    expect(deriveItemStatus(item({ kind: "module" }), { digest: "sha256:a", profile: { kind: "module", version: 1 } }, [], profiles).status).toBe("understood");
    expect(deriveItemStatus(item(), { digest: "sha256:a", profile: { kind: "screen", version: 1 } }, []).status).toBe("understood");
  });

  it("leaves no reason on an item that is not stale", () => {
    expect(deriveItemStatus(item(), undefined, [], profiles)).not.toHaveProperty("staleReason");
    expect(deriveItemStatus(item(), { digest: "sha256:a", profile: { kind: "screen", version: 2 } }, [], profiles)).not.toHaveProperty("staleReason");
  });
});

describe("profile versions", () => {
  it("reads the version of a profile document that names its kind", () => {
    expect(profileVersionOf('---\nkind: "screen"\nversion: 3\n---\n# x\n', "screen")).toBe(3);
    expect(profileVersionOf('---\nkind: "api"\nversion: 3\n---\n', "screen")).toBeUndefined();
    expect(profileVersionOf('---\nkind: "screen"\nversion: 0\n---\n', "screen")).toBeUndefined();
    expect(profileVersionOf("no front matter", "screen")).toBeUndefined();
  });

  it("lists the built-in profiles by kind", () => {
    const versions = builtinSpecProfileVersions();
    expect([...versions.keys()].sort()).toEqual(["api", "batch-job", "event", "integration", "report", "screen"]);
    expect([...versions.values()].every((version) => version >= 1)).toBe(true);
  });
});
