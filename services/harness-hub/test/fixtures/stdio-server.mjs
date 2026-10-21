import { serveCodingAgentStdio } from "../../dist/index.js";

const sha = (char) => char.repeat(40);
const hash = (char) => "sha256:" + char.repeat(64);
const readiness = {
  readyFor: ["implementation"],
  blockers: [],
  byActivity: {
    design: { ready: true, blockers: [] },
    implementation: { ready: true, blockers: [] },
    verification: { ready: true, blockers: [] },
  },
};

const access = {
  async listProjects(query) {
    if (process.env.KINTSUGI_TEST_FAILURE === "1") {
      const error = new Error(process.env.KINTSUGI_TEST_ERROR_MESSAGE ?? "private detail");
      error.code = "TOKEN_EXPIRED";
      throw error;
    }
    return { schemaVersion: "1", items: [{ projectId: "shop", name: "Shop" }], limit: query.limit ?? 25 };
  },
  async listTasks(query) {
    return { schemaVersion: "1", items: [{
      projectId: query.projectId,
      unitId: "billing/invoices/tax",
      title: "Invoice tax calculation",
      phase: "migrate",
      status: "in-progress",
      readiness,
    }], limit: query.limit ?? 25 };
  },
  async briefTask(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, unitId: query.unitId,
      activity: query.activity, title: "Invoice tax calculation",
      objective: "Use integer arithmetic.", acceptanceCriteria: ["Round once."],
      snapshotId: query.snapshotId ?? "ctx_fixture", contextRevision: hash("a"),
      documentRepoCommit: sha("a"), sources: [], requiredDeliverableIds: [],
      readiness, blockers: [], requiredContextStatus: "complete", sections: [],
      omittedSections: [], freshness: { isCurrent: true, observedAt: "2026-10-21T00:00:00.000Z" },
      fetchedAt: "2026-10-21T00:00:00.000Z",
    };
  },
  async getDocument(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, unitId: query.unitId,
      snapshotId: query.snapshotId, sourceId: query.sourceId, repositoryId: "project-docs",
      commit: sha("a"), path: query.sourceId + ".md", contentHash: hash("b"),
      text: query.projectId + "/" + query.unitId + "/" + query.snapshotId + "/" + query.sourceId,
      citations: [], complete: true, requiredSectionsRemaining: [],
    };
  },
  async searchDocuments(query) {
    return {
      schemaVersion: "1",
      items: [{
        sourceId: "src_design", sectionId: "sec_tax", role: "design",
        excerpt: query.query, citation: { sourceId: "src_design", path: "design.md", startLine: 1 },
      }],
      limit: query.limit ?? 25,
    };
  },
  async getReview(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, unitId: "billing/invoices/tax",
      reviewId: query.reviewId, generation: 1, currentness: "current", verdict: "pass",
      reviewedHead: sha("c"), reviewedBase: sha("d"), mergeBase: sha("e"), contextRevision: hash("a"),
      policyRevision: "policy-v1", agentVersion: "reviewer-v1", coverage: "complete", findings: [],
    };
  },
  async taskStatus(query) {
    return {
      schemaVersion: "1", projectId: query.projectId, unitId: query.unitId, status: "in-progress",
      evidenceAvailability: { pullRequests: "unavailable", reviews: process.env.KINTSUGI_TEST_REVIEWS === "1" ? "available" : "unavailable" },
      pullRequests: [], currentReviewIds: [], gates: [], nextAction: "Read the task brief.",
    };
  },
  async *watchTask() {
    yield {
      id: "event_001", projectId: "shop", unitId: "billing/invoices/tax",
      kind: "review.completed", occurredAt: "2026-10-21T00:00:00.000Z", metadata: {},
    };
  },
};

await serveCodingAgentStdio({
  access,
  capabilities: { reviews: process.env.KINTSUGI_TEST_REVIEWS === "1" },
});
