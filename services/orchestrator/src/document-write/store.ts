// Postgres access for the writer: the project's document repo (admin.project_repository,
// role `document` only — the writer reaches no other repository), its server, and the
// outcome rows in workflow.document_write (migration 009_document_writes.sql).

import { COMMIT_IDENTITY_SETTING, type CommitIdentity, DEFAULT_COMMIT_IDENTITY, commitIdentityProblems } from "@kintsugi/git";
import type { Pool } from "pg";
import type { RepositoryStore, SyncTarget } from "../git-sync/repositories.js";
import type { DocumentWriteRequest } from "../queues.js";

/** The document repo of a project, with everything needed to reach it. Holds plaintext — never log it. */
export interface DocumentRepoTarget {
  repository: SyncTarget;
  serverKind: string;
  serverBaseUrl: string;
  /** The server's token for its REST API (pull requests); absent for SSH-key and anonymous servers. */
  apiToken?: string;
}

export type DocumentWriteStatus = "queued" | "committed" | "pr-opened" | "merged" | "closed" | "unchanged" | "failed";

export interface DocumentWriteOutcome {
  status: Exclude<DocumentWriteStatus, "queued" | "failed" | "merged" | "closed">;
  /** Commit on the default branch (auto-commit paths). */
  commit?: string;
  /** The kintsugi/* branch holding the other paths, its tip and the pull request. */
  branch?: string;
  branchCommit?: string;
  prUrl?: string;
}

/** A write whose review branch has no recorded outcome yet. */
export interface AwaitingReview {
  id: string;
  projectId: string;
  branch: string;
  branchCommit?: string;
  prUrl?: string;
}

const MAX_ERROR_LENGTH = 2000;

export class DocumentWriteStore {
  constructor(
    private readonly pool: Pool,
    private readonly repositories: RepositoryStore,
  ) {}

  /**
   * The identity of kintsugi-bot's commits, as set in the portal (installation setting
   * `commit-identity`); the defaults when it is unset or unusable. Read per write.
   */
  async commitIdentity(): Promise<CommitIdentity> {
    const result = await this.pool.query<{ value: Partial<CommitIdentity> }>("select value from admin.installation_setting where key = $1", [COMMIT_IDENTITY_SETTING]);
    const value = result.rows[0]?.value;
    if (typeof value?.name !== "string" || typeof value.email !== "string") return { ...DEFAULT_COMMIT_IDENTITY };
    const identity = { name: value.name.trim(), email: value.email.trim() };
    return commitIdentityProblems(identity).length === 0 ? identity : { ...DEFAULT_COMMIT_IDENTITY };
  }

  /** The project's document repo; undefined when the project or its document repo is gone. */
  async target(projectId: string): Promise<DocumentRepoTarget | undefined> {
    const result = await this.pool.query<{ repository_id: string; kind: string; base_url: string }>(
      `select l.repository_id, s.kind, s.base_url
         from admin.project_repository l
         join admin.git_repository r on r.id = l.repository_id
         join admin.git_server s on s.id = r.server_id
        where l.project_id = $1 and l.role = 'document'`,
      [projectId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const repository = await this.repositories.target(row.repository_id);
    if (repository === undefined) return undefined;
    return {
      repository,
      serverKind: row.kind,
      serverBaseUrl: row.base_url,
      ...(repository.credential.kind === "token" ? { apiToken: repository.credential.token } : {}),
    };
  }

  /** Creates the row unless the producer did already (callers inside the worker skip the API). */
  async ensure(request: DocumentWriteRequest): Promise<void> {
    await this.pool.query(
      `insert into workflow.document_write (id, project_id, kind, message, actor, job_id, agent)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [request.writeId, request.projectId, request.kind, request.message, request.actor ?? null, request.jobId ?? null, request.agent ?? null],
    );
  }

  async markDone(id: string, outcome: DocumentWriteOutcome): Promise<void> {
    await this.pool.query(
      `update workflow.document_write
          set status = $2, commit_sha = $3, branch = $4, branch_commit_sha = $5, pr_url = $6, error = null, updated_at = now()
        where id = $1`,
      [id, outcome.status, outcome.commit ?? null, outcome.branch ?? null, outcome.branchCommit ?? null, outcome.prUrl ?? null],
    );
  }

  /** Writes on a review branch that nobody has merged or closed yet, newest first. */
  async awaitingReview(limit: number): Promise<AwaitingReview[]> {
    const result = await this.pool.query<{ id: string; project_id: string; branch: string; branch_commit_sha: string | null; pr_url: string | null }>(
      `select id, project_id, branch, branch_commit_sha, pr_url
         from workflow.document_write
        where branch is not null and status in ('committed', 'pr-opened')
        order by created_at desc
        limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      branch: row.branch,
      ...(row.branch_commit_sha === null ? {} : { branchCommit: row.branch_commit_sha }),
      ...(row.pr_url === null ? {} : { prUrl: row.pr_url }),
    }));
  }

  /** Records how a review ended; false when the write was not waiting any more (another pass was first). */
  async markReviewOutcome(id: string, outcome: "merged" | "closed"): Promise<boolean> {
    const result = await this.pool.query(
      "update workflow.document_write set status = $2, updated_at = now() where id = $1 and branch is not null and status in ('committed', 'pr-opened')",
      [id, outcome],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Records a failure; `message` must already be redacted. */
  async markFailed(id: string, message: string): Promise<void> {
    await this.pool.query("update workflow.document_write set status = 'failed', error = $2, updated_at = now() where id = $1", [
      id,
      message.slice(0, MAX_ERROR_LENGTH),
    ]);
  }
}
