import { serveMemberStdio } from "../../dist/index.js";

const sha = (char) => char.repeat(40);

const member = {
  async listProjects(query) {
    if (process.env.KINTSUGI_TEST_FAILURE === "1") {
      const error = new Error(process.env.KINTSUGI_TEST_ERROR_MESSAGE ?? "private detail");
      error.code = "TOKEN_EXPIRED";
      throw error;
    }
    if (process.env.KINTSUGI_TEST_STATUS !== undefined) {
      // As the Kintsugi client throws a refusal of the member API (its message already without the token).
      const error = new Error(process.env.KINTSUGI_TEST_ERROR_MESSAGE ?? "refused");
      error.name = "KintsugiClientError";
      error.code = "NOT_FOUND";
      error.status = Number(process.env.KINTSUGI_TEST_STATUS);
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
  async listPlugins() {
    return { schemaVersion: "1", items: [{ name: "context", title: "Project context", version: "1.0.0", description: "Read the documents" }], limit: 100 };
  },
  async pluginBundle() {
    throw new Error("not served over MCP");
  },
  async brainTree(query) {
    const node = (id, kind, title, summary, children) => ({
      id, kind, title, summary, summarySource: "readme", path: id.replace(/\/$/, ""), anchor: null,
      lineStart: null, lineEnd: null, subtreeEnd: null, tokens: 0, subtreeTokens: 10, children, ids: [], changed: null,
    });
    return {
      schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"),
      node: node("/", "root", "Shop · main", "", 1), breadcrumb: [],
      children: [node("01-standards/", "folder", "01-standards", "Conventions and review rules.", 1)], total: 1, offset: 0,
    };
  },
  async brainRead(query) {
    const node = {
      id: query.node, kind: "document", title: "Standards", summary: "", summarySource: "none", path: query.node, anchor: null,
      lineStart: 1, lineEnd: 1, subtreeEnd: 1, tokens: 3, subtreeTokens: 3, children: 0, ids: [], changed: null,
    };
    return {
      schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"), node, breadcrumb: [], scope: "subtree",
      text: "1\t# Standards", lineNumbers: true, citation: { nodeId: query.node, path: query.node, lineStart: 1, lineEnd: 1, commit: sha("a") },
      truncated: false, nextLine: null, children: [], outgoing: [], incoming: [], outgoingTotal: 0, incomingTotal: 0,
    };
  },
  async brainLookup(query) {
    return { schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"), query: query.query, matches: [] };
  },
  async brainGrep(query) {
    return { schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"), text: query.text, under: null, matches: [], truncated: false };
  },
  async brainBacklinks(query) {
    const node = (id) => ({
      id, kind: "document", title: id, summary: "", summarySource: "none", path: id.split("#")[0], anchor: null,
      lineStart: 3, lineEnd: 5, subtreeEnd: 5, tokens: 3, subtreeTokens: 3, children: 0, ids: [], changed: null,
    });
    return {
      schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"), node: node(query.node),
      items: [{ node: node("a.md"), target: node(query.node), linkKind: "link" }], total: 1, offset: 0, nextOffset: null,
    };
  },
  async brainChanges(query) {
    return { schemaVersion: "1", projectId: query.projectId, branch: "main", commit: sha("a"), since: sha("b"), files: [], linesKnown: true, truncated: false };
  },
  async recordActivity(input) {
    return { schemaVersion: "1", id: "act-" + input.kind };
  },
};

await serveMemberStdio({ member });
