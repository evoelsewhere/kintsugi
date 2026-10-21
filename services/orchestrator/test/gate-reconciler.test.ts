import { describe, expect, it, vi } from "vitest";
import * as adapter from "../src/gates/reconcile.js";
import type { GatePublicationCandidate } from "../src/gates/effective.js";

const sha = (c: string) => c.repeat(40);
const publication = {
  decision_id: "gate_" + "a".repeat(48), project_id: "shop", unit_id: "web/core/invoice", gate_id: "G4", state: "pending-publication",
  evidence: { deliverables: [] }, evidence_hash: "b".repeat(64), document_repository_id: "docs", record_path: "applications/web/units/core/invoice/reviews/G4.md",
  document_write_id: "write", write_status: "merged", pr_url: "https://github.example/org/docs/pull/9", record_commit: null,
} as unknown as GatePublicationCandidate;

function fixture(overrides: { state?: string; url?: string; human?: boolean; mergedAt?: string; linked?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("project_repository")) return {rows:overrides.linked === false ? [] : [{repository_id:"docs"}]};
    if (sql.includes("member_provider_observation")) return { rows: [{ server_id: "github", provider_repository_id: "42", provider_pull_request_id: "99", pull_request_number: 9 }] };
    if (sql.includes("member_provider_actor_mapping")) return { rows: overrides.human === false ? [] : [{ provider_actor_id: "200", user_id: "reviewer" }] };
    return { rows: [] };
  });
  const get = vi.fn(async () => ({ repositoryId: "42", pullRequestId: "99", headSha: sha("c"), mergeCommitSha: sha("d"), state: overrides.state ?? "merged", htmlUrl: overrides.url ?? publication.pr_url, authorId: "bot", mergedAt: overrides.mergedAt ?? "2026-10-22T00:00:00Z", reviews: [{ id: "1", actorId: "200", state: "APPROVED", commitSha: sha("c"), submittedAt: "2026-10-21T00:00:00Z" }] }));
  const repositories = { githubProviderConnection: vi.fn(async () => ({ kind: "github", baseUrl: "https://github.example", token: "test", repositoryPath: "org/docs" })) };
  return { query, get, repositories };
}

describe("provider-bound gate record reconciliation adapter", () => {
  it("blocks an old gate record after the project document repository changes",async()=>{
    const f=fixture({linked:false});
    const deps=new adapter.PostgresGateReconciler({pool:{query:f.query} as never,repositories:f.repositories as never,observer:{get:f.get} as never,storage:{} as never});
    await expect(deps.mergedRecord(publication)).resolves.toEqual({status:"unavailable"});
    expect(f.get).not.toHaveBeenCalled();
  });
  it("does not accept an approval submitted after the deliverable merged", async () => {
    const f = fixture({ mergedAt: "2026-10-20T00:00:00Z" });
    const deps = new adapter.PostgresGateReconciler({ pool: { query: f.query } as never, repositories: f.repositories as never, observer: { get: f.get } as never, storage: {} as never });
    await expect(deps.mergedRecord(publication)).resolves.toEqual({ status: "unavailable" });
  });
  it("uses provider merge identity rather than trusting a document_write merged flag", async () => {
    const f = fixture({ state: "open" });
    const deps = new adapter.PostgresGateReconciler({ pool: { query: f.query } as never, repositories: f.repositories as never, observer: { get: f.get } as never, storage: {} as never });
    await expect(deps.mergedRecord(publication)).resolves.toEqual({ status: "open" });
    expect(f.get).toHaveBeenCalled();
  });
  it("accepts a final squash merge only after independent mapped human approval", async () => {
    const f = fixture();
    const deps = new adapter.PostgresGateReconciler({ pool: { query: f.query } as never, repositories: f.repositories as never, observer: { get: f.get } as never, storage: {} as never });
    await expect(deps.mergedRecord(publication)).resolves.toEqual({ status: "merged", location: { repo: "docs", commit: sha("d"), path: publication.record_path } });
    const missing = fixture({ human: false });
    const denied = new adapter.PostgresGateReconciler({ pool: { query: missing.query } as never, repositories: missing.repositories as never, observer: { get: missing.get } as never, storage: {} as never });
    await expect(denied.mergedRecord(publication)).resolves.toEqual({ status: "unavailable" });
  });
  it("rejects a gate PR URL that belongs to another repository before observing it", async () => {
    const f = fixture();
    const deps = new adapter.PostgresGateReconciler({ pool: { query: f.query } as never, repositories: f.repositories as never, observer: { get: f.get } as never, storage: {} as never });
    await expect(deps.mergedRecord({ ...publication, pr_url: "https://github.example/other/docs/pull/9" })).resolves.toEqual({ status: "unavailable" });
    expect(f.get).not.toHaveBeenCalled();
  });
});
