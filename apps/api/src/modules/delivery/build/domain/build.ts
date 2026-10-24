// Domain of the build view (ADR-0071): after the design, a member implements and tests each unit on their own machine and
// tells Kintsugi which unit they built in which merge request; the runtime then reviews that merge request. The view joins
// the two: what the member recorded, what the review found, and which merge requests can be reviewed. Pure types.

/** What a member's harness recorded for a unit with the member command `build` (`build.test`, `build.mr`). Counts and links only. */
export interface MemberBuild {
  /** The merge request the member opened, as they recorded it (an http(s) URL). */
  mr?: string;
  branch?: string;
  /** The head commit of the merge request at the time the member recorded it; the reviewer reads this commit. */
  commit?: string;
  /** Cases executed and failed in the member's last test run. */
  cases?: number;
  failed?: number;
  /** `killed` when a deliberate break of the code turned a test red, `survived` when none did. */
  canary?: string;
  at: string;
  /** Only for a reader who may view member activity. */
  username?: string;
  harness?: string;
}

export type ReviewState = "none" | "running" | "in-pr" | "reviewed";

export interface UnitReview {
  state: ReviewState;
  /** The run that is reviewing it, or whose pull request is open. */
  runId?: string;
  prUrl?: string;
  /** From the published `_build/review.md`: the findings and the merge request commit they were made at. */
  blockers?: number;
  majors?: number;
  minors?: number;
  /** The member recorded a newer head commit than the one the review was made at: the review is out of date. */
  stale?: boolean;
}

export interface UnitBuildRow {
  /** `<module>/<unit>`. */
  key: string;
  module: string;
  unit: string;
  kind: string;
  title?: string;
  /** The unit has at least one merged design document. */
  designed: boolean;
  rules: number;
  member?: MemberBuild;
  review: UnitReview;
}

/** A merge request that members recorded for designed units; one run reviews one merge request at one commit. */
export interface MergeRequestView {
  url: string;
  branch?: string;
  commit: string;
  units: string[];
  /** Every unit of it has a review made at this commit. */
  reviewed: boolean;
}

export interface BuildTargetView {
  repositoryId: string;
  component?: string;
}

export interface BuildOverviewView {
  ref: { ref: string; commit: string };
  targets: BuildTargetView[];
  units: UnitBuildRow[];
  mergeRequests: MergeRequestView[];
}

export interface ReviewRunBody {
  units: string[];
  /** The target repository the merge request is on; the only target of the application when it has one. */
  target?: string;
}
