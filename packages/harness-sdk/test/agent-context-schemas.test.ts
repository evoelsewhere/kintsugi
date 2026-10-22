import { describe, expect, it } from "vitest";
import type {
  DocumentPage,
  CodingAgentWorkflowPort,
  ReviewReport,
  TaskBrief,
  TaskEvent,
  TaskStatus,
  TaskSummary,
} from "../src/agent-context.js";
import {
  documentQuerySchema,
  documentSearchQuerySchema,
  projectQuerySchema,
  reviewReportSchema,
  taskBriefQuerySchema,
  taskBriefSchema,
  taskQuerySchema,
  taskIdentitySchema,
  taskStatusSchema,
  taskEventQuerySchema,
} from "../src/agent-context-schemas.js";

const sha = (char: string): string => char.repeat(40);
const hash = (char: string): string => "sha256:" + char.repeat(64);
const readiness: TaskSummary["readiness"] = {
  readyFor: ["design"] as const,
  blockers: [
    {
      activity: "implementation" as const,
      code: "SOURCE_APPROVAL_PENDING" as const,
      sourceId: "src-detail",
      message: "Detailed design approval is pending.",
    },
  ],
  byActivity: {
    design: { ready: true, blockers: [] },
    implementation: {
      ready: false,
      blockers: [
        {
          activity: "implementation" as const,
          code: "SOURCE_APPROVAL_PENDING" as const,
          sourceId: "src-detail",
          message: "Detailed design approval is pending.",
        },
      ],
    },
    verification: { ready: false, blockers: [] },
  },
};

const partialBrief: TaskBrief = {
  schemaVersion: "1",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  activity: "implementation",
  title: "Invoice tax calculation",
  objective: "Implement approved invoice tax behavior.",
  acceptanceCriteria: ["Use integer arithmetic."],
  snapshotId: "ctx_001",
  contextRevision: hash("a"),
  documentRepoCommit: sha("a"),
  sources: [
    {
      sourceId: "src-detail",
      role: "detailed-design",
      repositoryId: "project-docs",
      commit: sha("a"),
      path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md",
      contentHash: hash("b"),
      availability: "present",
      publication: "published",
      approval: { status: "pending" },
    },
  ],
  requiredDeliverableIds: ["code", "design"],
  readiness,
  blockers: readiness.blockers,
  requiredContextStatus: "partial",
  sections: [],
  omittedSections: [{ sourceId: "src-detail", sectionId: "rounding-boundaries", required: true }],
  freshness: { isCurrent: true, observedAt: "2026-10-20T07:00:00.000Z" },
  fetchedAt: "2026-10-20T07:00:00.000Z",
};

const documentPage: DocumentPage = {
  schemaVersion: "1",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  snapshotId: "ctx_001",
  sourceId: "src-detail",
  repositoryId: "project-docs",
  commit: sha("a"),
  path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md",
  contentHash: hash("b"),
  text: "Round once at invoice total.",
  citations: [{ sourceId: "src-detail", path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md", startLine: 4, endLine: 4 }],
  complete: true,
  requiredSectionsRemaining: [],
};

const review: ReviewReport = {
  schemaVersion: "1",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  reviewId: "review_001",
  generation: 1,
  currentness: "current",
  verdict: "pass",
  reviewedHead: sha("c"),
  reviewedBase: sha("d"),
  mergeBase: sha("e"),
  contextRevision: hash("a"),
  policyRevision: "policy-v1",
  agentVersion: "reviewer-v1",
  coverage: "complete",
  findings: [],
};

const taskStatus: TaskStatus = {
  schemaVersion: "1",
  projectId: "modernization",
  unitId: "billing/invoices/tax",
  status: "in-progress",
  evidenceAvailability: { pullRequests: "unavailable", reviews: "unavailable" },
  pullRequests: [],
  currentReviewIds: [],
  gates: [],
  nextAction: "Open the required deliverable pull request.",
};

const port: CodingAgentWorkflowPort = {
  listProjects: async () => ({ schemaVersion: "1", items: [{ projectId: "modernization", name: "Modernization" }], limit: 25 }),
  listTasks: async () => ({
    schemaVersion: "1",
    items: [{ projectId: "modernization", unitId: "billing/invoices/tax", title: "Invoice tax calculation", phase: "migrate", status: "in-progress", readiness }],
    limit: 25,
  }),
  briefTask: async () => partialBrief,
  getDocument: async () => documentPage,
  searchDocuments: async () => ({
    schemaVersion: "1",
    items: [{ sourceId: "src-detail", sectionId: "rounding", role: "detailed-design", excerpt: "Round at invoice total.", citation: documentPage.citations[0]! }],
    limit: 25,
  }),
  getReview: async () => review,
  taskStatus: async () => taskStatus,
  watchTask: async function* (): AsyncIterable<TaskEvent> {
    yield { id: "event_001", projectId: "modernization", unitId: "billing/invoices/tax", kind: "review.completed", occurredAt: "2026-10-20T07:00:00.000Z", metadata: {} };
  },
};

describe("Coding Agent Workflow wire schemas", () => {
  it("requires explicit PR and review observation availability in task status", () => {
    expect(taskStatusSchema.parse(taskStatus)).toEqual(taskStatus);
    const { evidenceAvailability: _availability, ...withoutAvailability } = taskStatus;
    expect(taskStatusSchema.safeParse(withoutAvailability).success).toBe(false);
  });

  it("accepts confirmed PR status and the full gate publication lifecycle", () => {
    const result = taskStatusSchema.parse({
      ...taskStatus,
      evidenceAvailability: { pullRequests: "available", reviews: "available" },
      pullRequests: [{
        repositoryId: "billing-api",
        pullRequestId: "pr_42",
        state: "merged",
        headRevision: sha("f"),
        updatedAt: "2026-10-21T09:00:00.000Z",
      }],
      gates: [
        { unitId: "web/core/invoice", gateId: "G3", status: "waived", publication: "effective" },
        { unitId: "web/catalog/product", gateId: "G4", status: "pending", publication: "awaiting-merge" },
        { unitId: "web/core/invoice", gateId: "G5", status: "unknown", publication: "failed" },
      ],
    });

    expect(result.pullRequests[0]?.pullRequestId).toBe("pr_42");
    expect(result.gates.map(({ publication }) => publication)).toEqual(["effective", "awaiting-merge", "failed"]);
  });

  it("rejects unknown selectors and arbitrary document paths", () => {
    expect(taskBriefQuerySchema.safeParse({
      schemaVersion: "1",
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      activity: "implementation",
      filesystemPath: "../../secrets",
    }).success).toBe(false);

    expect(documentQuerySchema.safeParse({
      schemaVersion: "1",
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      snapshotId: "ctx_001",
      sourceId: "src-detail",
      path: "../../secrets",
    }).success).toBe(false);
  });

  it("requires snapshot selectors for document retrieval and search", () => {
    expect(documentQuerySchema.safeParse({
      schemaVersion: "1",
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      sourceId: "src-detail",
    }).success).toBe(false);

    expect(documentSearchQuerySchema.safeParse({
      schemaVersion: "1",
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      query: "rounding",
    }).success).toBe(false);
  });

  it("applies bounded pagination and rejects an excessive search query", () => {
    expect(projectQuerySchema.parse({}).limit).toBe(25);
    expect(projectQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(taskQuerySchema.parse({ projectId: "modernization", limit: "3", mine: "true" })).toMatchObject({ limit: 3, mine: true });
    expect(taskQuerySchema.parse({ projectId: "modernization", mine: "false" }).mine).toBe(false);
    expect(taskBriefQuerySchema.parse({
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      activity: "implementation",
      maxBytes: "2048",
    }).maxBytes).toBe(2048);
    expect(taskQuerySchema.safeParse({ schemaVersion: "1", projectId: "modernization", limit: 101 }).success).toBe(false);
    expect(documentSearchQuerySchema.safeParse({
      schemaVersion: "1",
      projectId: "modernization",
      unitId: "billing/invoices/tax",
      snapshotId: "ctx_001",
      query: "x".repeat(501),
    }).success).toBe(false);
  });

  it("keeps task event streams unbounded by default and validates an optional event limit", () => {
    const identity = { projectId: "modernization", unitId: "billing/invoices/tax" };
    expect(taskEventQuerySchema.parse(identity)).not.toHaveProperty("limit");
    expect(taskEventQuerySchema.parse({ ...identity, limit: "1000" }).limit).toBe(1000);
    expect(taskEventQuerySchema.safeParse({ ...identity, limit: "0" }).success).toBe(false);
    expect(taskEventQuerySchema.safeParse({ ...identity, limit: "1001" }).success).toBe(false);
  });

  it("preserves partial-context metadata instead of claiming a complete brief", () => {
    const result = taskBriefSchema.safeParse(partialBrief);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredContextStatus).toBe("partial");
      expect(result.data.omittedSections[0]?.sectionId).toBe("rounding-boundaries");
    }
  });

  it("accepts bounded cited section text in a task brief", () => {
    const result = taskBriefSchema.safeParse({
      ...partialBrief,
      sections: [{
        sourceId: "src-detail",
        sectionId: "sec-rounding",
        title: "Rounding boundaries",
        text: "Round once at the invoice total.",
        required: true,
        citation: {
          sourceId: "src-detail",
          path: "10-applications/billing/02-modern/invoices/tax/detail/logic.md",
          startLine: 4,
          endLine: 4,
        },
      }],
    });

    expect(result.success).toBe(true);
  });

  it("implements all eight shared port methods with typed results", async () => {
    expect(Object.keys(port)).toHaveLength(8);
    expect((await port.taskStatus({ schemaVersion: "1", projectId: "modernization", unitId: "billing/invoices/tax" })).status).toBe("in-progress");
  });
});


describe("existing project identifier compatibility", () => {
  it("accepts existing API project IDs up to 100 characters", () => {
    expect(taskQuerySchema.safeParse({ projectId: "a".repeat(100) }).success).toBe(true);
    expect(taskQuerySchema.safeParse({ projectId: "a".repeat(101) }).success).toBe(false);
    expect(taskIdentitySchema.safeParse({ projectId: "a".repeat(100), unitId: "billing/invoices/" + "u".repeat(63) }).success).toBe(true);
    expect(taskIdentitySchema.safeParse({ projectId: "shop", unitId: "billing/invoices/Tax" }).success).toBe(false);
    expect(taskIdentitySchema.safeParse({ projectId: "a".repeat(100), unitId: "billing/invoices/" + "u".repeat(64) }).success).toBe(false);
  });
});

describe("review report findings", () => {
  const finding = {
    findingId: "finding_rounding",
    severity: "high",
    title: "Preserve invoice rounding",
    rationale: "The rounding step runs before line items are summed.",
    citation: { sourceId: "pull-request", path: "src/invoice.ts", startLine: 8, endLine: 11 },
    currentness: "current",
  };

  it("accepts explicit suggested repair guidance in a cited finding", () => {
    const result = reviewReportSchema.safeParse({
      ...review,
      verdict: "fail",
      findings: [{
        ...finding,
        repairGuidance: "Sum the unrounded line amounts, then round the invoice total once.",
      }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects findings without suggested repair guidance", () => {
    expect(reviewReportSchema.safeParse({ ...review, verdict: "fail", findings: [finding] }).success).toBe(false);
  });

  it("requires each finding to cite a source path and line", () => {
    const { citation: _citation, ...uncited } = finding;
    expect(reviewReportSchema.safeParse({ ...review, verdict: "fail", findings: [{
      ...uncited,
      repairGuidance: "Add the boundary check before multiplication.",
    }] }).success).toBe(false);
    expect(reviewReportSchema.safeParse({ ...review, verdict: "fail", findings: [{
      ...finding,
      repairGuidance: "Add the boundary check before multiplication.",
      citation: { sourceId: "pull-request", path: "src/invoice.ts" },
    }] }).success).toBe(false);
  });

  it("requires the reviewed merge base used by the immutable input", () => {
    const { mergeBase: _mergeBase, ...withoutMergeBase } = review;
    expect(reviewReportSchema.safeParse(withoutMergeBase).success).toBe(false);
  });
});
