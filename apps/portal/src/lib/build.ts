// What the Build page works out from the overview (ADR-0071): what a unit can do next, why a review cannot start, the words for a
// member's record and a review, and the commands a member types to build a unit with their own AI client. No React, so it is tested alone.

import type { BuildOverview, BuildTarget, BuildUnit, MergeRequest } from "./api/build";

/** Whether a unit can be sent to the runtime for review: the member recorded a merge request and no review is working on it. */
export function reviewable(unit: BuildUnit): boolean {
  return unit.designed && unit.member?.mr !== undefined && unit.member.commit !== undefined && unit.review.state !== "running" && unit.review.state !== "in-pr";
}

/** Why a review cannot start for the application at all, or undefined. */
export function reviewBlocker(overview: BuildOverview, target: BuildTarget | undefined): string | undefined {
  if (overview.targets.length === 0) return "Link a target repository to the application: the merge request is on one of them.";
  if (target === undefined) return "Choose the target repository the merge request is on.";
  return undefined;
}

/** Why one unit cannot be reviewed now, or undefined. */
export function unitBlocker(unit: BuildUnit): string | undefined {
  if (!unit.designed) return "The unit has no merged design yet.";
  if (unit.member?.mr === undefined) return "No merge request is recorded: the member records it with the member command build.";
  if (unit.review.state === "running") return "A review is running.";
  if (unit.review.state === "in-pr") return "The review is in an open pull request.";
  return undefined;
}

/** The units of a merge request a review can take now. */
export function reviewableUnits(request: MergeRequest, units: readonly BuildUnit[]): string[] {
  return request.units.filter((key) => {
    const unit = units.find((entry) => entry.key === key);
    return unit !== undefined && reviewable(unit);
  });
}

/** One line of what the member recorded for a unit: the cases of their last run and the canary. */
export function memberLine(unit: BuildUnit): string | undefined {
  const record = unit.member;
  if (record === undefined) return undefined;
  const parts: string[] = [];
  if (record.cases !== undefined) parts.push(`${record.cases} case${record.cases === 1 ? "" : "s"}${record.failed ? `, ${record.failed} failed` : ""}`);
  if (record.canary !== undefined) parts.push(`canary ${record.canary}`);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The state of a unit's review in a few words. */
export function reviewLine(unit: BuildUnit): string {
  const review = unit.review;
  switch (review.state) {
    case "running":
      return "reviewing";
    case "in-pr":
      return "review in a pull request";
    case "reviewed": {
      const open = (review.blockers ?? 0) + (review.majors ?? 0);
      const found = open === 0 ? "no blocker or major" : `${review.blockers ?? 0} blocker${review.blockers === 1 ? "" : "s"}, ${review.majors ?? 0} major${review.majors === 1 ? "" : "s"}`;
      return review.stale === true ? `${found} (out of date)` : found;
    }
    case "none":
      return "not reviewed";
  }
}

/** The commands a member runs to build a unit with their own AI client (the member command `build`, ADR-0071). */
export function cliCommands(options: { url: string; projectId: string; unit: string; client?: "claude" | "codex" | "copilot" }): Array<{ title: string; code: string }> {
  const client = options.client ?? "claude";
  return [
    { title: "Install the CLI once", code: `curl -fsSL ${options.url}/api/v1/releases/latest/install.sh | sh` },
    { title: "Sign in to this project", code: `kintsugi login ${options.projectId}` },
    { title: "Set up your AI clients (it lists the ones it finds and asks global or this workspace)", code: "kintsugi init" },
    { title: "Install the Modernize plugin into them (an administrator grants it to you in Project → Member plugins)", code: "kintsugi install plugin modernize --all" },
    {
      title: client === "claude" ? "In Claude Code, in the target repository" : client === "copilot" ? "In GitHub Copilot, in the target repository" : "In Codex, in the target repository",
      // Claude Code and Copilot run it as /plugin:name; Codex has no slash form for it, so the member names the skill.
      code: client === "codex" ? `$build ${options.unit} ${options.projectId}` : `/modernize:build ${options.unit} ${options.projectId}`,
    },
  ];
}
