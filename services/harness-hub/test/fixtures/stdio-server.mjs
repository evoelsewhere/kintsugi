import { serveMemberStdio } from "../../dist/index.js";

const sha = (char) => char.repeat(40);

const member = {
  async listProjects(query) {
    if (process.env.KINTSUGI_TEST_FAILURE === "1") {
      const error = new Error(process.env.KINTSUGI_TEST_ERROR_MESSAGE ?? "private detail");
      error.code = "TOKEN_EXPIRED";
      throw error;
    }
    return { schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: query.limit ?? 25 };
  },
  async documentTree(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, ref: query.ref ?? "refs/heads/main", commit: sha("a"), path: query.path ?? "",
      entries: [{ path: "01-standards", name: "01-standards", kind: "dir" }],
    };
  },
  async documentFile(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, ref: query.ref ?? "refs/heads/main", commit: sha("a"), path: query.path,
      size: 5, content: query.projectId + ":" + query.path,
    };
  },
};

await serveMemberStdio({ member });
