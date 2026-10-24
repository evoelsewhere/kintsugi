// Typed access to the build view of an application (ADR-0071). Mirrors apps/api → modules/delivery/build: after the design a
// member implements and tests each unit on their machine and records the merge request; the runtime reviews it.

import { apiGet, apiSend } from "../api";
import type { JobRunView } from "./job-runs";

/** What a member's harness recorded for a unit with the member command `build`. */
export interface MemberBuild {
  /** The merge request, an http(s) URL. */
  mr?: string;
  branch?: string;
  /** The head commit of the merge request when it was recorded; the reviewer reads this commit. */
  commit?: string;
  cases?: number;
  failed?: number;
  canary?: string;
  at: string;
  /** Only for a reader who may view member activity. */
  username?: string;
  harness?: string;
}

export type ReviewState = "none" | "running" | "in-pr" | "reviewed";

export interface UnitReview {
  state: ReviewState;
  runId?: string;
  prUrl?: string;
  blockers?: number;
  majors?: number;
  minors?: number;
  /** The member pushed a newer commit than the one the review was made at. */
  stale?: boolean;
}

export interface BuildUnit {
  key: string;
  module: string;
  unit: string;
  kind: string;
  title?: string;
  designed: boolean;
  rules: number;
  member?: MemberBuild;
  review: UnitReview;
}

export interface MergeRequest {
  url: string;
  branch?: string;
  commit: string;
  units: string[];
  /** Every unit of it has a review made at this commit. */
  reviewed: boolean;
}

export interface BuildTarget {
  repositoryId: string;
  component?: string;
}

export interface BuildOverview {
  ref: { ref: string; commit: string };
  targets: BuildTarget[];
  units: BuildUnit[];
  mergeRequests: MergeRequest[];
}

export interface BuildConflict {
  unit: string;
  reason: string;
}

const base = (projectId: string, applicationId: string): string => `/api/projects/${encodeURIComponent(projectId)}/applications/${encodeURIComponent(applicationId)}/build`;

export const buildApi = {
  overview: (projectId: string, applicationId: string) => apiGet<BuildOverview>(base(projectId, applicationId)),
  review: (projectId: string, applicationId: string, body: { units: string[]; target?: string }) => apiSend<JobRunView>(`${base(projectId, applicationId)}/reviews`, "POST", body),
};
