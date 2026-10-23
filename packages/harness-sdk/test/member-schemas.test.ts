import { describe, expect, it } from "vitest";
import { documentFileQuerySchema, documentTreeQuerySchema, projectListResultSchema, projectQuerySchema } from "../src/member-schemas.js";

describe("member schemas", () => {
  it("applies list defaults and bounds", () => {
    expect(projectQuerySchema.parse({})).toMatchObject({ schemaVersion: "1", limit: 25 });
    expect(projectQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("requires a project and a path for a file read and rejects unknown keys", () => {
    expect(documentFileQuerySchema.safeParse({ projectId: "shop" }).success).toBe(false);
    expect(documentFileQuerySchema.safeParse({ projectId: "shop", path: "01-standards/a.md", extra: 1 }).success).toBe(false);
    expect(documentFileQuerySchema.parse({ projectId: "shop", path: "01-standards/a.md" })).toMatchObject({ projectId: "shop", path: "01-standards/a.md" });
  });

  it("allows a tree read of the root", () => {
    expect(documentTreeQuerySchema.parse({ projectId: "shop" })).toMatchObject({ projectId: "shop" });
    expect(documentTreeQuerySchema.safeParse({ projectId: "Not A Project" }).success).toBe(false);
  });

  it("validates project list results", () => {
    expect(projectListResultSchema.safeParse({ schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: 25 }).success).toBe(true);
    expect(projectListResultSchema.safeParse({ schemaVersion: "1", items: [{ projectId: "!!!", name: "x" }], limit: 1 }).success).toBe(false);
  });
});
