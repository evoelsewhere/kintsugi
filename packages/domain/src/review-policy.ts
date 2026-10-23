/** Provider evidence normalized for policy evaluation; display names never grant authority. */
export interface ReviewCheckEvidence {
  id: string;
  name: string;
  appId?: string;
  evaluatedRevision: string;
  runAttempt?: number;
  startedAt?: string;
  status: string;
  conclusion?: string;
}

export interface ReviewHumanEvidence {
  id: string;
  reviewerId?: string;
  state: string;
  commitSha?: string;
  submittedAt?: string;
}

export interface ReviewEvidenceInput {
  contextRevision: string;
  observedHeadSha: string;
  evaluatedRevision: string;
  coverage: "complete" | "partial";
  observationComplete: boolean;
  checks: readonly ReviewCheckEvidence[];
  reviews: readonly ReviewHumanEvidence[];
}

export interface ReviewPolicy {
  contextRevision: string;
  expectedHeadSha: string;
  evaluatedRevision: string;
  requiredChecks: readonly { name: string; producerAppId: string }[];
  requiredApprovals: number;
  authorizedReviewerIds: readonly string[];
  latestReviewablePush: boolean;
}

export interface EvidenceVerdict {
  status: "satisfied" | "unsatisfied" | "inconclusive";
  unmetRequirements: string[];
}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTEXT_REVISION = /^sha256:[0-9a-f]{64}$/;

function validTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function latestCheck(
  checks: readonly ReviewCheckEvidence[],
): { status: "ready"; checks: readonly ReviewCheckEvidence[] } | { status: "unknown" } {
  const ordered = checks.map((check) => ({ check, started: validTimestamp(check.startedAt) }));
  const attemptsKnown = ordered.every(({ check }) => check.runAttempt !== undefined);
  if (ordered.some(({ check, started }) =>
    started === undefined || (check.runAttempt !== undefined && (!Number.isSafeInteger(check.runAttempt) || check.runAttempt < 1))) ||
      (!attemptsKnown && ordered.some(({ check }) => check.runAttempt !== undefined))) {
    return { status: "unknown" };
  }
  ordered.sort((left, right) => {
    const attempt = attemptsKnown ? right.check.runAttempt! - left.check.runAttempt! : 0;
    if (attempt !== 0) return attempt;
    const time = right.started! - left.started!;
    if (time !== 0) return time;
    return left.check.id < right.check.id ? -1 : left.check.id > right.check.id ? 1 : 0;
  });
  const newest = ordered[0];
  if (newest === undefined) return { status: "unknown" };
  const tied = ordered.filter(({ check, started }) => started === newest.started &&
    (!attemptsKnown || check.runAttempt === newest.check.runAttempt));
  return { status: "ready", checks: tied.map(({ check }) => check) };
}

function latestReviewsByReviewer(reviews: readonly ReviewHumanEvidence[]): {
  latest: ReviewHumanEvidence[];
  unknown: boolean;
} {
  const byReviewer = new Map<string, Array<{ review: ReviewHumanEvidence; submitted: number }>>();
  let unknown = false;
  for (const review of reviews) {
    if (review.reviewerId === undefined || review.reviewerId.trim() === "") continue;
    const submitted = validTimestamp(review.submittedAt);
    if (submitted === undefined) {
      unknown = true;
      continue;
    }
    const values = byReviewer.get(review.reviewerId) ?? [];
    values.push({ review, submitted });
    byReviewer.set(review.reviewerId, values);
  }
  const latest: ReviewHumanEvidence[] = [];
  for (const values of byReviewer.values()) {
    const newestTime = Math.max(...values.map((entry) => entry.submitted));
    const newest = values.filter((entry) => entry.submitted === newestTime);
    if (newest.length > 1 && new Set(newest.map((entry) => entry.review.state)).size > 1) unknown = true;
    latest.push(...newest.map((entry) => entry.review));
  }
  return { latest, unknown };
}

/**
 * Evaluates provider checks and human approvals against explicit producer,
 * revision, coverage, and authority requirements. Unknown or partial evidence
 * is never treated as a pass.
 */
export function evaluateReviewEvidence(input: ReviewEvidenceInput, policy: ReviewPolicy): EvidenceVerdict {
  const unmet = new Set<string>();
  let unknown = false;

  if (!CONTEXT_REVISION.test(policy.contextRevision) || input.contextRevision !== policy.contextRevision) {
    unmet.add("context.revision");
    unknown = true;
  }
  if (!FULL_SHA.test(policy.expectedHeadSha) || input.observedHeadSha !== policy.expectedHeadSha) {
    unmet.add("pull-request.current-head");
    unknown = true;
  }
  if (!FULL_SHA.test(policy.evaluatedRevision) || input.evaluatedRevision !== policy.evaluatedRevision) {
    unmet.add("checks.evaluated-revision");
    unknown = true;
  }
  if (input.coverage !== "complete") {
    unmet.add("review.coverage.complete");
    unknown = true;
  }
  if (!input.observationComplete) {
    unmet.add("provider.observation.complete");
    unknown = true;
  }

  for (const requirement of policy.requiredChecks) {
    if (requirement.name.trim() === "" || requirement.producerAppId.trim() === "") {
      unmet.add("policy.required-check.valid");
      unknown = true;
      continue;
    }
    const named = input.checks.filter((check) => check.name === requirement.name);
    if (named.length === 0) {
      unmet.add(`checks.${requirement.name}.present`);
      continue;
    }
    const expectedProducer = named.filter((check) => check.appId === requirement.producerAppId);
    if (expectedProducer.length === 0) {
      unmet.add(`checks.${requirement.name}.expected-producer`);
      continue;
    }
    const expectedRevision = expectedProducer.filter((check) => check.evaluatedRevision === policy.evaluatedRevision);
    if (expectedRevision.length === 0) {
      unmet.add(`checks.${requirement.name}.evaluated-revision`);
      continue;
    }
    const latest = latestCheck(expectedRevision);
    if (latest.status === "unknown") {
      unmet.add(`checks.${requirement.name}.latest-attempt-known`);
      unknown = true;
      continue;
    }
    if (latest.checks.length !== 1) {
      if (latest.checks.some((check) => check.status !== "completed" || check.conclusion !== "success")) {
        unmet.add(`checks.${requirement.name}.latest-attempt-unambiguous`);
        unknown = true;
      }
      continue;
    }
    const [check] = latest.checks;
    if (check?.status !== "completed") {
      unmet.add(`checks.${requirement.name}.completed`);
      unknown = true;
    } else if (check.conclusion !== "success") {
      unmet.add(`checks.${requirement.name}.successful-execution`);
    }
  }

  if (!Number.isSafeInteger(policy.requiredApprovals) || policy.requiredApprovals < 0) {
    unmet.add("policy.required-approvals.valid");
    unknown = true;
  } else if (policy.requiredApprovals > 0) {
    const authorized = new Set(policy.authorizedReviewerIds.filter((id) => id.trim() !== ""));
    const latest = latestReviewsByReviewer(input.reviews);
    if (latest.unknown) {
      unmet.add("reviews.latest-attempt-known");
      unknown = true;
    }
    const authorizedApprovals = latest.latest.filter((review) => authorized.has(review.reviewerId ?? "") &&
      review.state.toUpperCase() === "APPROVED");
    const currentApprovals = authorizedApprovals.filter((review) =>
      !policy.latestReviewablePush || review.commitSha === policy.expectedHeadSha);
    if (policy.latestReviewablePush && authorizedApprovals.some((review) => review.commitSha === undefined)) {
      unmet.add("reviews.reviewed-head-known");
      unknown = true;
    }
    if (policy.latestReviewablePush && currentApprovals.length < policy.requiredApprovals &&
        authorizedApprovals.some((review) => review.commitSha !== undefined && review.commitSha !== policy.expectedHeadSha)) {
      unmet.add("reviews.latest-reviewable-push");
    }
    if (currentApprovals.length < policy.requiredApprovals &&
        (authorized.size === 0 || (authorizedApprovals.length === 0 && latest.latest.some((review) =>
          review.state.toUpperCase() === "APPROVED" && !authorized.has(review.reviewerId ?? ""))))) {
      unmet.add("reviews.authority");
    }
    if (currentApprovals.length < policy.requiredApprovals) unmet.add("reviews.required-authorized-approvals");
  }

  const unmetRequirements = [...unmet].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return {
    status: unmetRequirements.length === 0 ? "satisfied" : unknown ? "inconclusive" : "unsatisfied",
    unmetRequirements,
  };
}
