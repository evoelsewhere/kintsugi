import { describe, expect, it } from "vitest";
import { commentsQuerySchema, commentsSchema, documentFileQuerySchema, documentTreeQuerySchema, projectListResultSchema, projectQuerySchema } from "../src/member-schemas.js";

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

  it("reads the open comments of a page by default, and refuses what the contract does not name", () => {
    expect(commentsQuerySchema.parse({ projectId: "shop", path: "20-spaces/eng/setup.md" })).toMatchObject({ schemaVersion: "1", status: "open" });
    expect(commentsQuerySchema.parse({ projectId: "shop", path: "a.md", status: "all" })).toMatchObject({ status: "all" });
    for (const bad of [{ projectId: "shop" }, { projectId: "shop", path: "" }, { projectId: "shop", path: "a.md", status: "resolved" }, { projectId: "shop", path: "a.md", extra: 1 }, { path: "a.md" }]) {
      expect(commentsQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("parses the comments of a page and refuses an account id or any other field in one", () => {
    const comment = { id: "c1", parentId: null, author: { username: "ada", displayName: "Ada" }, body: "Is this still right?", createdAt: "2026-11-05T01:00:00.000Z", editedAt: null, resolved: false, deleted: false, node: "setup", status: "moved", line: 12, quote: "Start here" };
    const answer = { schemaVersion: "1", projectId: "shop", page: { key: "PAGE-ENG-0001", path: "20-spaces/eng/setup.md" }, comments: [comment], truncated: false };
    expect(commentsSchema.safeParse(answer).success).toBe(true);
    expect(commentsSchema.safeParse({ ...answer, comments: [{ ...comment, author: { id: "u1", username: "ada", displayName: "Ada" } }] }).success).toBe(false);
    expect(commentsSchema.safeParse({ ...answer, comments: [{ ...comment, status: "lost" }] }).success).toBe(false);
  });

  it("validates project list results", () => {
    expect(projectListResultSchema.safeParse({ schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: 25 }).success).toBe(true);
    expect(projectListResultSchema.safeParse({ schemaVersion: "1", items: [{ projectId: "!!!", name: "x" }], limit: 1 }).success).toBe(false);
  });
});
